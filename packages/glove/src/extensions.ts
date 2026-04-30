import z from "zod";
import type {
  ContentPart,
  Context,
  Executor,
  Message,
  ModelPromptResult,
  Observer,
  PromptMachine,
  Tool,
} from "./core";
import type { IGloveRunnable } from "./glove";

/**
 * Runtime handles handed to hook / skill / mention handlers so they can
 * mutate agent state, force compaction, swap models, append messages, etc.
 */
export interface AgentControls {
  context: Context;
  observer: Observer;
  promptMachine: PromptMachine;
  executor: Executor;
  glove: IGloveRunnable;
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
 *         // source === "user" — `parsedText` is the user message after token stripping
 *         // (the rest of "/research-mode tell me about ribosomes").
 *         return `Switch to research mode. User said: ${parsedText}`;
 *       },
 *     });
 */
export interface SkillContext {
  name: string;
  /** When `source === "user"`: the user message after token stripping. When `source === "agent"`: same as `args ?? ""`. */
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
 * Context passed to a mention (subagent) handler.
 *
 * Mentions are invoked exclusively through the auto-registered
 * `glove_invoke_subagent` tool — the main agent calls it with a name and a
 * task prompt. Following Claude Code's subagent model, the handler runs in
 * isolation and returns a single text/content payload that becomes the
 * tool result. The user's `@subagent-name` text in the original message is
 * NOT parsed or stripped by glove; it reaches the model verbatim and acts
 * as a routing signal that nudges the agent to call the tool.
 */
export interface MentionContext {
  name: string;
  /** The task prompt the agent supplied when calling `glove_invoke_subagent`. */
  prompt: string;
  controls: AgentControls;
  signal?: AbortSignal;
}

export type MentionHandler = (
  ctx: MentionContext,
) => Promise<string | ContentPart[]>;

export interface MentionOptions {
  /** Short description shown to the agent in the invoke-subagent tool listing. Used by the model to decide when to invoke this subagent. */
  description?: string;
}

/** Arguments to `Glove.defineMention`. Mirrors the object-form shape of `Glove.fold`. */
export interface DefineMentionArgs extends MentionOptions {
  name: string;
  handler: MentionHandler;
}

export interface RegisteredMention {
  handler: MentionHandler;
  description?: string;
}

export interface ParsedTokens {
  stripped: string;
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
  // We rebuild the stripped string by collecting non-consumed segments.
  let cursor = 0;
  let stripped = "";
  TOKEN_RE.lastIndex = 0;

  for (const match of text.matchAll(TOKEN_RE)) {
    const lead = match[1] ?? "";
    const name = match[2];
    const matchStart = match.index!;
    const tokenStart = matchStart + lead.length;
    const tokenEnd = matchStart + match[0].length;

    let bound = false;
    if (registries.hooks.has(name)) {
      hooks.push(name);
      bound = true;
    } else if (registries.skills.has(name)) {
      skills.push(name);
      bound = true;
    }

    if (!bound) continue;

    // Emit text from cursor up to (and including) the leading whitespace,
    // then drop the token itself.
    stripped += text.slice(cursor, tokenStart);
    cursor = tokenEnd;
  }

  stripped += text.slice(cursor);
  // Collapse runs of whitespace introduced by removals, but preserve newlines.
  stripped = stripped.replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").trim();

  return { stripped, hooks, skills };
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
 * task to a registered mention. Reads the live registry on each call so
 * mentions registered after `build()` are immediately invocable.
 *
 * Following Claude Code's subagent model, the parent agent writes the
 * subagent's task prompt itself and the subagent's final output is
 * returned verbatim as the tool result.
 */
export function createMentionInvokeTool(
  mentions: ReadonlyMap<string, RegisteredMention>,
  controlsFactory: () => AgentControls,
): Tool<InvokeSubagentInput> {
  const tool: Tool<InvokeSubagentInput> = {
    name: "glove_invoke_subagent",
    description: renderMentionToolDescription(mentions),
    input_schema: InvokeSubagentInput,
    async run(input, _handOver) {
      const entry = mentions.get(input.name);
      if (!entry) {
        const known = [...mentions.keys()].join(", ") || "(none)";
        return {
          status: "error",
          message: `Subagent "${input.name}" is not registered. Use one of: ${known}.`,
          data: null,
        };
      }
      const result = await entry.handler({
        name: input.name,
        prompt: input.prompt,
        controls: controlsFactory(),
      });
      if (typeof result === "string") {
        return {
          status: "success",
          data: {
            subagent: input.name,
            content: result || "[subagent produced no text content]",
          },
        };
      }
      const text = result
        .filter((p) => p.type === "text" && p.text)
        .map((p) => p.text!)
        .join("\n");
      return {
        status: "success",
        data: {
          subagent: input.name,
          content: text || "[non-text subagent content]",
        },
        renderData: { subagent: input.name, parts: result },
      };
    },
  };
  return tool;
}

/** Rebuild the subagent dispatch tool description to reflect the current registry. */
export function renderMentionToolDescription(
  mentions: ReadonlyMap<string, RegisteredMention>,
): string {
  if (mentions.size === 0) {
    return (
      `Invoke a registered subagent with a task prompt. ` +
      `No subagents are currently registered; calling this tool will return an error.`
    );
  }
  const lines = [...mentions.entries()].map(([name, entry]) =>
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
