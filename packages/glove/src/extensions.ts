import type {
  ContentPart,
  Context,
  Executor,
  HandOverFunction,
  Message,
  ModelPromptResult,
  Observer,
  PromptMachine,
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
  parsedText: string;
  controls: AgentControls;
}

export type SkillHandler = (ctx: SkillContext) => Promise<string | ContentPart[]>;

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

/** Format a skill injection as a synthetic user message body. */
export function formatSkillMessage(
  name: string,
  injection: string | ContentPart[],
): Message {
  if (typeof injection === "string") {
    return {
      sender: "user",
      text: `[Skill: ${name}]\n${injection}`,
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
  };
}
