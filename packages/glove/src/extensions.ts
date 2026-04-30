import z from "zod";
import type {
  ContentPart,
  Context,
  Executor,
  HandOverFunction,
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

export interface SkillContext {
  name: string;
  /** User-supplied text that came in alongside the skill invocation. Empty when invoked by the agent without args. */
  parsedText: string;
  /** Free-form arguments supplied by the agent when it invokes the skill via the tool. Undefined when user-invoked. */
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

export interface RegisteredSkill {
  handler: SkillHandler;
  description?: string;
  exposeToAgent: boolean;
}

export interface MentionContext {
  name: string;
  message: Message;
  controls: AgentControls;
  handOver?: HandOverFunction;
  signal?: AbortSignal;
}

export type MentionHandler = (
  ctx: MentionContext,
) => Promise<ModelPromptResult | Message>;

export interface ParsedTokens {
  stripped: string;
  hooks: string[];
  skills: string[];
  mention: string | null;
}

export interface ExtensionRegistries {
  hooks: ReadonlySet<string>;
  skills: ReadonlySet<string>;
  mentions: ReadonlySet<string>;
}

const TOKEN_RE = /(^|\s)([/@])([A-Za-z][\w-]*)(?=\s|$)/g;

/**
 * Scan `text` for `/name` and `@name` tokens. A token only "binds" if its
 * name appears in the corresponding registry; otherwise it is left in place
 * (so paths like `/usr/local` and emails like `a@b.com` survive untouched).
 *
 * - `/name` binds to the hook registry first, otherwise to skills.
 * - `@name` binds to the mention registry. Only the first match wins;
 *   subsequent `@registered-name` occurrences are left in place.
 * - Bound tokens are removed from `stripped` (the surrounding whitespace is
 *   collapsed).
 */
export function parseTokens(
  text: string,
  registries: ExtensionRegistries,
): ParsedTokens {
  const hooks: string[] = [];
  const skills: string[] = [];
  let mention: string | null = null;

  // Walk matches and decide per-match whether to consume.
  // We rebuild the stripped string by collecting non-consumed segments.
  let cursor = 0;
  let stripped = "";
  TOKEN_RE.lastIndex = 0;

  for (const match of text.matchAll(TOKEN_RE)) {
    const lead = match[1] ?? "";
    const prefix = match[2];
    const name = match[3];
    const matchStart = match.index!;
    const tokenStart = matchStart + lead.length;
    const tokenEnd = matchStart + match[0].length;

    let bound = false;
    if (prefix === "/") {
      if (registries.hooks.has(name)) {
        hooks.push(name);
        bound = true;
      } else if (registries.skills.has(name)) {
        skills.push(name);
        bound = true;
      }
    } else if (prefix === "@") {
      if (mention === null && registries.mentions.has(name)) {
        mention = name;
        bound = true;
      }
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

  return { stripped, hooks, skills, mention };
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
      const text =
        typeof injection === "string"
          ? injection
          : injection
              .filter((p) => p.type === "text" && p.text)
              .map((p) => p.text!)
              .join("\n");
      return {
        status: "success",
        data: { skill: input.name, content: text || "[skill produced no text content]" },
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
