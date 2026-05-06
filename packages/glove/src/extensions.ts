import z from "zod";
import type {
  ContentPart,
  Context,
  Executor,
  Message,
  ModelPromptResult,
  NotifySubscribersFunction,
  Observer,
  PromptMachine,
  StoreAdapter,
  SubscriberAdapter,
  Tool,
} from "./core";
import type { DisplayManagerAdapter } from "./display-manager";
import type { IGloveRunnable } from "./glove";

/**
 * Runtime handles handed to hook / skill / subagent factories so they can
 * mutate agent state, force compaction, swap models, append messages, etc.
 *
 * `displayManager` is the parent agent's display stack. Subagent factories
 * that want their tools to render UI in the parent's display stack can
 * either build their child Glove with `displayManager: parentControls.displayManager`
 * up front, or call `child.setDisplayManager(parentControls.displayManager)`
 * later to opt in mid-run.
 */
export interface AgentControls {
  context: Context;
  observer: Observer;
  promptMachine: PromptMachine;
  executor: Executor;
  glove: IGloveRunnable;
  store: StoreAdapter
  displayManager: DisplayManagerAdapter
  forceCompaction: () => Promise<void>;
}

export interface HookContext {
  name: string;
  rawText: string;
  parsedText: string;
  controls: AgentControls;
  signal?: AbortSignal;
}

export interface HookResult {
  rewriteText?: string;
  shortCircuit?:
    | { message: Message }
    | { result: ModelPromptResult };
}

export type HookHandler = (ctx: HookContext) => Promise<HookResult | void>;

/**
 * Context passed to a skill handler.
 *
 * A skill handler is invoked from two distinct paths and must dispatch on `source`:
 *
 *     glove.defineSkill({
 *       name: "research-mode",
 *       exposeToAgent: true,
 *       async handler({ source, args, parsedText }) {
 *         if (source === "agent") {
 *           // Agent called glove_invoke_skill — `args` holds the model-supplied string.
 *           return `Switch to research mode. Focus: ${args ?? "general"}.`;
 *         }
 *         // source === "user" — `parsedText` is the user message with the directive
 *         // replaced by its placeholder (e.g. "[invoked_extension__skill_research-mode] tell me about ribosomes").
 *         return `Switch to research mode. User said: ${parsedText}`;
 *       },
 *     });
 */
export interface SkillContext {
  name: string;
  /** When `source === "user"`: the user message with each bound `/name` directive replaced by its `[invoked_extension__<type>_<name>]` placeholder. When `source === "agent"`: same as `args ?? ""`. */
  parsedText: string;
  /** Free-form arguments supplied by the agent when it invokes the skill via `glove_invoke_skill`. Undefined when user-invoked. */
  args?: string;
  /** Where the invocation originated. */
  source: "user" | "agent";
  controls: AgentControls;
}

export type SkillHandler = (ctx: SkillContext) => Promise<string | ContentPart[]>;

export interface SkillOptions {
  /** Short description shown to the agent in the invoke-skill tool listing. */
  description?: string;
  /** When true, the agent can pull this skill in via the `glove_invoke_skill` tool. */
  exposeToAgent?: boolean;
}

/** Arguments to `Glove.defineSkill`. Mirrors the object-form shape of `Glove.fold`. */
export interface DefineSkillArgs extends SkillOptions {
  name: string;
  handler: SkillHandler;
}

export interface RegisteredSkill {
  handler: SkillHandler;
  description?: string;
  exposeToAgent: boolean;
}

/**
 * Context passed to a subagent factory each time the parent agent invokes
 * the subagent via `glove_invoke_subagent`.
 *
 * The factory typically uses `parentStore.createSubAgentStore(name, durable)`
 * to provision a child store, then constructs and `.build(subStore)`s a fresh
 * `Glove` configured with whatever model, system prompt, tools, and
 * compaction policy the subagent should use. Returning the built runnable
 * hands it to the dispatcher, which calls `processRequest(prompt)` and
 * returns the final agent message text as the tool result.
 *
 * The user's `@subagent-name` text in the original message is NOT parsed or
 * stripped by glove; it reaches the model verbatim and acts as a routing
 * signal that nudges the agent to call the dispatch tool.
 */
export interface SubAgentFactoryContext {
  /** Subagent name as registered with `defineSubAgent`. */
  name: string;
  /** The task prompt the parent agent supplied when calling `glove_invoke_subagent`. */
  prompt: string;
  /** The parent agent's store. Use `createSubAgentStore(name, durable)` to derive a child store. */
  parentStore: StoreAdapter;
  /** Full parent agent controls (context, observer, promptMachine, executor, glove, store, forceCompaction). */
  parentControls: AgentControls;
}

/**
 * A subagent factory builds and returns a fully-configured Glove runnable.
 * The dispatcher will run it with the parent-supplied prompt, fan out the
 * parent's subscribers to it for the duration of the run, and return the
 * final agent text as the tool result.
 */
export type SubAgentFactory = (
  ctx: SubAgentFactoryContext,
) => Promise<IGloveRunnable> | IGloveRunnable;

export interface SubAgentOptions {
  /** Short description shown to the agent in the invoke-subagent tool listing. Used by the model to decide when to invoke this subagent. */
  description?: string;
}

/** Arguments to `Glove.defineSubAgent`. */
export interface DefineSubAgentArgs extends SubAgentOptions {
  name: string;
  factory: SubAgentFactory;
}

export interface RegisteredSubAgent {
  factory: SubAgentFactory;
  description?: string;
}

export interface ParsedTokens {
  /**
   * The original text with each bound `/name` directive replaced by a
   * non-triggerable placeholder of the form `[invoked_extension__<type>_<name>]`
   * (where `<type>` is `hook` or `skill`). Unbound `/name` tokens — including
   * filesystem-like paths such as `/usr/local` — are left untouched.
   */
  replaced: string;
  hooks: string[];
  skills: string[];
}

export interface ExtensionRegistries {
  hooks: ReadonlySet<string>;
  skills: ReadonlySet<string>;
}

const TOKEN_RE = /(^|\s)\/([A-Za-z][\w-]*)(?=\s|$)/g;

/**
 * Scan `text` for `/name` directive tokens. A token only "binds" if its
 * name appears in the hook or skill registry; otherwise it is left in
 * place (so paths like `/usr/local` survive untouched).
 *
 * `/name` binds to the hook registry first, otherwise to skills.
 *
 * Bound directives are replaced — not removed — with a non-triggerable
 * placeholder of the form `[invoked_extension__<type>_<name>]` so the
 * persisted user message preserves the structure of what the user typed
 * and the model can see that an extension fired, without the placeholder
 * itself re-binding on a future parse.
 *
 * `@mention` tokens are intentionally NOT parsed — following Claude Code's
 * subagent convention, mentions reach the model verbatim and are routed
 * through the `glove_invoke_subagent` tool.
 */
export function parseTokens(
  text: string,
  registries: ExtensionRegistries,
): ParsedTokens {
  const hooks: string[] = [];
  const skills: string[] = [];

  // Walk matches and decide per-match whether to consume.
  // We rebuild the replaced string by collecting non-consumed segments
  // and substituting placeholders for bound directives.
  let cursor = 0;
  let replaced = "";
  TOKEN_RE.lastIndex = 0;

  for (const match of text.matchAll(TOKEN_RE)) {
    const lead = match[1] ?? "";
    const name = match[2];
    const matchStart = match.index!;
    const tokenStart = matchStart + lead.length;
    const tokenEnd = matchStart + match[0].length;

    let kind: "hook" | "skill" | null = null;
    if (registries.hooks.has(name)) {
      hooks.push(name);
      kind = "hook";
    } else if (registries.skills.has(name)) {
      skills.push(name);
      kind = "skill";
    }

    if (!kind) continue;

    // Emit text up to (and including) the leading whitespace, then the
    // placeholder in place of the original `/name` token.
    replaced += text.slice(cursor, tokenStart);
    replaced += `[invoked_extension__${kind}_${name}]`;
    cursor = tokenEnd;
  }

  replaced += text.slice(cursor);

  return { replaced, hooks, skills };
}

const InvokeSkillInput = z.object({
  name: z.string().describe("The name of the skill to invoke. Must match one of the skills listed in this tool's description."),
  args: z.string().optional().describe("Optional free-form arguments to pass to the skill handler."),
});

type InvokeSkillInput = z.infer<typeof InvokeSkillInput>;

/**
 * Build the `glove_invoke_skill` tool that lets the agent pull in any
 * skill registered with `exposeToAgent: true`. Reads the live registry
 * each call so skills registered after `build()` are immediately usable.
 */
export function createSkillInvokeTool(
  skills: ReadonlyMap<string, RegisteredSkill>,
  controlsFactory: () => AgentControls,
  notifyExtension: NotifySubscribersFunction,
): Tool<InvokeSkillInput> {
  const tool: Tool<InvokeSkillInput> = {
    name: "glove_invoke_skill",
    description: renderSkillToolDescription(skills),
    input_schema: InvokeSkillInput,
    async run(input) {
      const entry = skills.get(input.name);
      if (!entry || !entry.exposeToAgent) {
        return {
          status: "error",
          message: `Skill "${input.name}" is not available. Use one of: ${listExposedSkills(skills).join(", ") || "(none)"}.`,
          data: null,
        };
      }
      await notifyExtension("skill_invoked", {
        name: input.name,
        source: "agent",
        args: input.args,
      });
      const injection = await entry.handler({
        name: input.name,
        parsedText: input.args ?? "",
        args: input.args,
        source: "agent",
        controls: controlsFactory(),
      });
      if (typeof injection === "string") {
        return {
          status: "success",
          data: {
            skill: input.name,
            content: injection || "[skill produced no text content]",
          },
        };
      }
      // ContentPart[]: text parts go to `data` for the model. The full part
      // array is preserved on `renderData` so client renderers (e.g. React
      // tool result views) keep multimodal content. Mirrors the convention
      // used by glove-mcp's bridged tool results.
      const text = injection
        .filter((p) => p.type === "text" && p.text)
        .map((p) => p.text!)
        .join("\n");
      return {
        status: "success",
        data: {
          skill: input.name,
          content: text || "[non-text skill content]",
        },
        renderData: { skill: input.name, parts: injection },
      };
    },
  };
  return tool;
}

/** Rebuild the tool description to reflect the current set of exposed skills. */
export function renderSkillToolDescription(
  skills: ReadonlyMap<string, RegisteredSkill>,
): string {
  const exposed = listExposedSkills(skills);
  if (exposed.length === 0) {
    return (
      `Invoke a registered skill to pull its contextual instructions or content into this turn. ` +
      `No skills are currently exposed; calling this tool will return an error.`
    );
  }
  const lines = exposed.map((name) => {
    const entry = skills.get(name)!;
    return `- ${name}${entry.description ? ` — ${entry.description}` : ""}`;
  });
  return (
    `Invoke a registered skill to pull its contextual instructions or content into this turn. ` +
    `The skill's content is returned as the tool result and remains available for the rest of the conversation. ` +
    `Available skills:\n${lines.join("\n")}`
  );
}

function listExposedSkills(skills: ReadonlyMap<string, RegisteredSkill>): string[] {
  return [...skills.entries()]
    .filter(([, s]) => s.exposeToAgent)
    .map(([name]) => name);
}

const InvokeSubagentInput = z.object({
  name: z.string().describe("The name of the subagent to invoke. Must match one of the subagents listed in this tool's description."),
  prompt: z.string().describe("The task prompt to hand to the subagent. Be specific and self-contained — the subagent does not see the parent conversation."),
});

type InvokeSubagentInput = z.infer<typeof InvokeSubagentInput>;

/**
 * Build the `glove_invoke_subagent` tool that lets the main agent route a
 * task to a registered subagent. Reads the live registry on each call so
 * subagents registered after `build()` are immediately invocable.
 *
 * For each invocation:
 *   1. Calls the subagent factory to obtain a child `IGloveRunnable`.
 *   2. Attaches the parent's subscribers to the child Glove so consumers
 *      receive every model/tool/observer event the child emits.
 *   3. Runs `child.processRequest(prompt, signal)` — the parent's abort
 *      signal is forwarded so a parent-side cancel propagates into the
 *      child's `Agent.ask` loop and unwinds it on the next iteration.
 *   4. Detaches the parent subscribers from the child (so a cached/durable
 *      runnable doesn't accumulate duplicates across invocations).
 *
 * The `subagent_invoked` / `subagent_completed` bracket events are NOT
 * fired here — the Executor wraps every call to this tool with them so
 * the bracket is symmetric even when an abort short-circuits the
 * dispatcher's promise chain (see `SUBAGENT_DISPATCH_TOOL_NAME` in core).
 */
export function createSubAgentInvokeTool(
  subAgents: ReadonlyMap<string, RegisteredSubAgent>,
  controlsFactory: () => AgentControls,
  getParentSubscribers: () => ReadonlyArray<SubscriberAdapter>,
): Tool<InvokeSubagentInput> {
  const tool: Tool<InvokeSubagentInput> = {
    name: "glove_invoke_subagent",
    description: renderSubAgentToolDescription(subAgents),
    input_schema: InvokeSubagentInput,
    async run(input, _handOver, signal) {
      const entry = subAgents.get(input.name);
      if (!entry) {
        const known = [...subAgents.keys()].join(", ") || "(none)";
        return {
          status: "error",
          message: `Subagent "${input.name}" is not registered. Use one of: ${known}.`,
          data: null,
        };
      }

      const parentControls = controlsFactory();
      const parentSubscribers = [...getParentSubscribers()];

      let childGlove: IGloveRunnable;
      try {
        childGlove = await entry.factory({
          name: input.name,
          prompt: input.prompt,
          parentStore: parentControls.store,
          parentControls,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return {
          status: "error",
          message: `Subagent "${input.name}" factory threw: ${message}`,
          data: null,
        };
      }

      for (const sub of parentSubscribers) childGlove.addSubscriber(sub);

      try {
        const result = await childGlove.processRequest(input.prompt, signal);
        const text = extractAgentText(result);
        return {
          status: "success",
          data: {
            subagent: input.name,
            content: text || "[subagent produced no text content]",
          },
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return {
          status: "error",
          message: `Subagent "${input.name}" failed: ${message}`,
          data: null,
        };
      } finally {
        for (const sub of parentSubscribers) childGlove.removeSubscriber(sub);
      }
    },
  };
  return tool;
}

function extractAgentText(result: ModelPromptResult | Message): string {
  // Message has `sender`; ModelPromptResult has `messages`.
  if ("sender" in result) return result.text ?? "";
  const lastAgent = [...result.messages].reverse().find((m) => m.sender === "agent");
  return lastAgent?.text ?? "";
}

/** Rebuild the subagent dispatch tool description to reflect the current registry. */
export function renderSubAgentToolDescription(
  subAgents: ReadonlyMap<string, RegisteredSubAgent>,
): string {
  if (subAgents.size === 0) {
    return (
      `Invoke a registered subagent with a task prompt. ` +
      `No subagents are currently registered; calling this tool will return an error.`
    );
  }
  const lines = [...subAgents.entries()].map(([name, entry]) =>
    `- ${name}${entry.description ? ` — ${entry.description}` : ""}`
  );
  return (
    `Invoke a registered subagent with a task prompt. The subagent runs in an isolated context — its only input is the prompt you supply, so make it self-contained. The subagent's final output is returned verbatim as this tool's result.\n\n` +
    `When the user @-mentions a subagent name (e.g. "@reviewer please look at this"), invoke the corresponding subagent here.\n\n` +
    `Available subagents:\n${lines.join("\n")}`
  );
}

/** Format a skill injection as a synthetic user message body. */
export function formatSkillMessage(
  name: string,
  injection: string | ContentPart[],
): Message {
  if (typeof injection === "string") {
    return {
      sender: "user",
      text: `[Skill: ${name}]\n${injection}`,
      is_skill_injection: true,
    };
  }
  const textPart = injection
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text!)
    .join("\n");
  return {
    sender: "user",
    text: `[Skill: ${name}]\n${textPart || "[multimodal skill content]"}`,
    content: [
      { type: "text", text: `[Skill: ${name}]` },
      ...injection,
    ],
    is_skill_injection: true,
  };
}
