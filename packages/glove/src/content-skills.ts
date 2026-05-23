import z from "zod";
import type { Tool, ToolResultData } from "./core";
import type { IGloveBuilder, IGloveRunnable } from "./glove";

/**
 * A static, content-shaped skill. The full text ships with the Glove
 * configuration — no filesystem required at runtime. Designed for coding
 * agents that may be running in sandboxed / filesystem-less environments
 * (e.g. browser, glovebox, embedded agents) where Claude Code's
 * filesystem-backed skill layout is not available.
 *
 * Skills are pure data — there are no handlers. To register them on a
 * Glove, call `useReadSkill(glove, [skill, ...])`.
 */
export interface ContentSkill {
  /** Unique identifier. Used to invoke the skill via `/name` or `glove_read_skill`. */
  name: string;
  /** One-line description shown to the agent in the skill listing. */
  description: string;
  /**
   * Optional handle indicating where extended content lives. Interpreted
   * by the `SkillReader`. For the in-memory reader this is opaque metadata;
   * for an FS-backed reader it might be the directory path; for a remote
   * reader it might be a URL or KV key.
   */
  path?: string;
  /** Main body. Returned verbatim when the agent reads the skill with no section. */
  content: string;
  /**
   * Optional named sections (e.g. `api-reference`, `examples`). Mirrors
   * Claude Code's `SKILL.md` + accompanying files convention. Agents fetch
   * sections via `glove_read_skill({ name, section })`.
   */
  sections?: Record<string, string>;
  /**
   * Higher priority skills keep their description in the listing when the
   * token budget is tight. Lower priority falls back to name-only. Default 0.
   */
  priority?: number;
  /**
   * Omit from the listing block in the tool description. Still readable
   * by name. Useful for skills whose existence shouldn't bias the model
   * (test fixtures, opt-in expert skills).
   */
  hidden?: boolean;
}

/** Lightweight summary used for the listing block. */
export interface SkillSummary {
  name: string;
  description: string;
  path?: string;
  sections?: string[];
  priority?: number;
  hidden?: boolean;
}

/** Tool result shape — the actual body the agent sees inside the XML wrapper. */
export interface SkillReadResult {
  name: string;
  description: string;
  path?: string;
  /** The content body — either the main content or a requested section. */
  content: string;
  /** Which section was returned. Omitted = main content. */
  section?: string;
  /** Names of every section available on this skill, so the agent can follow up. */
  available_sections?: string[];
}

/**
 * Pluggable source of skill content. Default implementation is in-memory
 * (`createMemorySkillReader`). Replace with a filesystem, fetch-based, DB,
 * or remote-KV reader for production agents.
 */
export interface SkillReader {
  /** List every skill the reader knows about. Used to render the listing block. */
  list(): Promise<SkillSummary[]>;
  /** Read a skill by name. Returns `null` when the skill or section does not exist. */
  read(name: string, section?: string): Promise<SkillReadResult | null>;
}

/**
 * Default in-memory reader. Holds the array of `ContentSkill`s by name
 * and serves reads synchronously.
 */
export function createMemorySkillReader(skills: ContentSkill[]): SkillReader {
  const byName = new Map<string, ContentSkill>(skills.map((s) => [s.name, s]));
  return {
    async list() {
      return [...byName.values()].map(summarize);
    },
    async read(name, section) {
      const skill = byName.get(name);
      if (!skill) return null;
      const available = skill.sections ? Object.keys(skill.sections) : undefined;
      if (section) {
        const body = skill.sections?.[section];
        if (!body) return null;
        return {
          name: skill.name,
          description: skill.description,
          path: skill.path,
          content: body,
          section,
          available_sections: available,
        };
      }
      return {
        name: skill.name,
        description: skill.description,
        path: skill.path,
        content: skill.content,
        available_sections: available,
      };
    },
  };
}

function summarize(s: ContentSkill): SkillSummary {
  return {
    name: s.name,
    description: s.description,
    path: s.path,
    sections: s.sections ? Object.keys(s.sections) : undefined,
    priority: s.priority,
    hidden: s.hidden,
  };
}

// ─── Budget + listing rendering ────────────────────────────────────────────

/** Approximate chars-per-token used to convert the token budget into a char cap. */
export const CHARS_PER_TOKEN = 4;

/** Default token budget for the listing block: 2% of a 100K compaction limit. */
export const DEFAULT_LISTING_BUDGET_TOKENS = 2000;

/**
 * Compute a default listing budget from a compaction limit (in tokens).
 * Returns `Math.floor(compactionLimitTokens * 0.02)`.
 */
export function defaultListingBudgetTokens(compactionLimitTokens: number): number {
  return Math.max(256, Math.floor(compactionLimitTokens * 0.02));
}

/**
 * Render the `<available_skills>` listing block embedded in the tool
 * description. Greedy fill: priority desc, then descriptions are kept until
 * the budget is exhausted; overflow falls back to a name-only line.
 */
export function renderSkillListing(
  summaries: SkillSummary[],
  budgetTokens: number = DEFAULT_LISTING_BUDGET_TOKENS,
): string {
  const visible = summaries.filter((s) => !s.hidden);
  if (visible.length === 0) {
    return "<available_skills>\n  <!-- no skills registered -->\n</available_skills>";
  }

  const charBudget = budgetTokens * CHARS_PER_TOKEN;
  const ranked = [...visible].sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.name.localeCompare(b.name),
  );

  const fullLines: string[] = [];
  let elidedCount = 0;
  const openTag = "<available_skills>\n";
  const closeTag = "\n</available_skills>";
  let used = openTag.length + closeTag.length;

  for (const s of ranked) {
    const line = renderFullSkillLine(s);
    if (used + line.length + 1 <= charBudget) {
      fullLines.push(line);
      used += line.length + 1; // +1 for the joining newline
    } else {
      elidedCount += 1;
    }
  }

  if (elidedCount === 0) {
    return `<available_skills>\n${fullLines.join("\n")}\n</available_skills>`;
  }

  // Try to fit any number of name-only lines for the elided tail. If we
  // can't fit them all, emit a `<!-- N more skills omitted -->` comment.
  const elided = ranked.filter((s) => !fullLines.some((line) => line.includes(`name="${s.name}"`)));
  const tailLines: string[] = [];
  for (const s of elided) {
    const line = renderNameOnlyLine(s);
    if (used + line.length + 1 <= charBudget) {
      tailLines.push(line);
      used += line.length + 1;
    }
  }
  const stillElided = elided.length - tailLines.length;
  const omittedComment = stillElided > 0
    ? `  <!-- ${stillElided} more skill${stillElided === 1 ? "" : "s"} omitted; call glove_read_skill with the name to load -->`
    : "";

  const body = [...fullLines, ...tailLines, omittedComment].filter(Boolean).join("\n");
  return `<available_skills>\n${body}\n</available_skills>`;
}

function renderFullSkillLine(s: SkillSummary): string {
  const sectionsAttr = s.sections && s.sections.length > 0
    ? ` sections="${s.sections.join(",")}"`
    : "";
  return `  <skill name="${escapeAttr(s.name)}"${sectionsAttr}>${escapeText(s.description)}</skill>`;
}

function renderNameOnlyLine(s: SkillSummary): string {
  return `  <skill name="${escapeAttr(s.name)}" />`;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── XML rendering for tool results ────────────────────────────────────────

/**
 * Render a `SkillReadResult` as an XML-wrapped string suitable for the tool
 * result `data` field. Content is emitted verbatim — models handle nested
 * angle brackets fine, and CDATA noise would hurt readability more than help.
 */
export function renderSkillReadResultXml(result: SkillReadResult): string {
  const attrs = [
    `name="${escapeAttr(result.name)}"`,
    result.path ? `path="${escapeAttr(result.path)}"` : "",
    result.section ? `section="${escapeAttr(result.section)}"` : "",
  ].filter(Boolean).join(" ");

  const sectionsBlock = result.available_sections && result.available_sections.length > 0
    ? `\n<sections>${result.available_sections.join(",")}</sections>`
    : "";

  return `<skill ${attrs}>\n<content>\n${result.content}\n</content>${sectionsBlock}\n</skill>`;
}

// ─── Tool factory + helper ─────────────────────────────────────────────────

export const READ_SKILL_TOOL_NAME = "glove_read_skill";

const ReadSkillInputSchema = z.object({
  name: z.string().describe("Name of the skill to read. Must be one of the skills listed in this tool's description."),
  section: z.string().optional().describe("Optional section to retrieve (e.g. 'api-reference', 'examples'). Omit to get the main content plus a list of available sections."),
});

type ReadSkillInput = z.infer<typeof ReadSkillInputSchema>;

export interface ReadSkillToolOptions {
  /** Override the tool name. Default: `glove_read_skill`. */
  toolName?: string;
  /** Override the token budget for the listing block in the tool description. Default: 2000 tokens. */
  listingBudgetTokens?: number;
  /** Pre-fetched summaries for the description, used when the reader is async. */
  initialSummaries?: SkillSummary[];
  /** Extra text appended after the listing block in the tool description. */
  descriptionSuffix?: string;
}

/**
 * Build the `glove_read_skill` tool. The tool reads from the supplied
 * `SkillReader` on every call, so a custom reader can serve content that
 * changes over time (e.g. a database-backed skill registry).
 *
 * The description embeds a `<available_skills>` XML block listing the
 * skills known at construction time, capped by the listing budget. If the
 * reader is async / dynamic, refresh the description out of band by
 * mutating the tool's `description` field after a re-list.
 */
export function createReadSkillTool(
  reader: SkillReader,
  options: ReadSkillToolOptions = {},
): Tool<ReadSkillInput> {
  const toolName = options.toolName ?? READ_SKILL_TOOL_NAME;
  const budget = options.listingBudgetTokens ?? DEFAULT_LISTING_BUDGET_TOKENS;
  const summaries = options.initialSummaries ?? [];
  const description = renderReadSkillDescription(summaries, budget, options.descriptionSuffix);

  const tool: Tool<ReadSkillInput> = {
    name: toolName,
    description,
    input_schema: ReadSkillInputSchema,
    async run(input): Promise<ToolResultData> {
      const result = await reader.read(input.name, input.section);
      if (!result) {
        const known = (await reader.list())
          .filter((s) => !s.hidden)
          .map((s) => s.name)
          .join(", ") || "(none)";
        const sectionNote = input.section ? ` (section "${input.section}")` : "";
        return {
          status: "error",
          message: `Skill "${input.name}"${sectionNote} not found. Known skills: ${known}.`,
          data: null,
        };
      }
      return {
        status: "success",
        data: renderSkillReadResultXml(result),
        renderData: result,
      };
    },
  };
  return tool;
}

/** Build the tool description with the listing block + standard preamble. */
export function renderReadSkillDescription(
  summaries: SkillSummary[],
  budgetTokens: number = DEFAULT_LISTING_BUDGET_TOKENS,
  suffix?: string,
): string {
  const preamble =
    "Read a registered skill. Returns the skill's content wrapped in `<skill>...<content>...</content></skill>` along with a `path` handle (opaque — your reader interprets it) and the list of available sections. " +
    "Pass `section` to fetch a specific section like 'api-reference' or 'examples'. Skills listed by name only (without a description) are still readable — call this tool with the name to load the content.";
  const listing = renderSkillListing(summaries, budgetTokens);
  const tail = suffix ? `\n\n${suffix}` : "";
  return `${preamble}\n\n${listing}${tail}`;
}

// ─── useReadSkill ──────────────────────────────────────────────────────────

export interface UseReadSkillOptions {
  /** Max tokens of listing rendered into the tool description. Default: 2000. */
  listingBudgetTokens?: number;
  /** Override the reader. If `skills` is a `SkillReader`, this is ignored. */
  reader?: SkillReader;
  /** Override the tool name. Default: `glove_read_skill`. */
  toolName?: string;
  /** Extra text appended after the listing block in the tool description. */
  descriptionSuffix?: string;
  /**
   * Wire user-side `/skill-name` invocation. Default `true` for `ContentSkill[]`
   * input. When `true` with a custom reader, the reader is listed once at
   * registration time and each skill name becomes parsable.
   */
  wireUserDirectives?: boolean;
}

type FoldableGlove = IGloveBuilder | IGloveRunnable;

function isSkillReader(value: ContentSkill[] | SkillReader): value is SkillReader {
  return !Array.isArray(value)
    && typeof (value as SkillReader).list === "function"
    && typeof (value as SkillReader).read === "function";
}

/**
 * Fold the `glove_read_skill` tool onto a Glove and (optionally) wire each
 * skill name into the user-side `/name` directive parser so a user typing
 * `/python-debug` materialises the skill's content as a synthetic user
 * message.
 *
 * `skills` may be either an array of `ContentSkill`s or a custom
 * `SkillReader`. The array form is the common case for coding agents that
 * ship skills as part of the agent bundle. Use a custom reader to source
 * skill content from disk, fetch, S3, or a database.
 *
 * The returned value is the same `glove` instance — chainable. Idiomatic
 * with `useMemoryReader` / `useContext` from `glove-memory`.
 *
 * @example
 *   useReadSkill(glove, [
 *     {
 *       name: "python-debug",
 *       description: "Diagnose Python errors and apply fix patterns.",
 *       content: "# Python Debugging\n...",
 *       sections: {
 *         "api-reference": "# API\n...",
 *         "examples": "# Examples\n...",
 *       },
 *     },
 *   ]);
 */
export function useReadSkill<G extends FoldableGlove>(
  glove: G,
  skills: ContentSkill[] | SkillReader,
  options: UseReadSkillOptions = {},
): G {
  const reader: SkillReader = isSkillReader(skills)
    ? skills
    : (options.reader ?? createMemorySkillReader(skills));

  const budget = options.listingBudgetTokens ?? DEFAULT_LISTING_BUDGET_TOKENS;
  const wireDirectives = options.wireUserDirectives ?? true;

  // Pull an initial listing synchronously when we have a literal array — that
  // keeps the typical case allocation-free and the tool description live by
  // the time the next turn fires. For custom readers we list once async and
  // patch the description in place.
  let initialSummaries: SkillSummary[] = [];
  if (!isSkillReader(skills)) {
    initialSummaries = skills.map(summarize);
  }

  const tool = createReadSkillTool(reader, {
    toolName: options.toolName,
    listingBudgetTokens: budget,
    initialSummaries,
    descriptionSuffix: options.descriptionSuffix,
  });

  glove.fold({
    name: tool.name,
    description: tool.description,
    inputSchema: ReadSkillInputSchema,
    async do(input) {
      return tool.run(input);
    },
  });

  if (isSkillReader(skills)) {
    // Refresh the tool description once the reader resolves its listing.
    void reader.list().then((summaries) => {
      const refreshed = renderReadSkillDescription(summaries, budget, options.descriptionSuffix);
      // Find the registered tool and update its description in place.
      const executor = (glove as unknown as { executor?: { tools: Tool<unknown>[] } }).executor;
      const registered = executor?.tools.find((t) => t.name === tool.name);
      if (registered) registered.description = refreshed;
      if (wireDirectives) wireUserDirectivesForSummaries(glove, summaries, reader);
    });
  } else if (wireDirectives) {
    wireUserDirectivesForArray(glove, skills);
  }

  return glove;
}

/**
 * For each ContentSkill, register a thin `defineSkill` so the existing
 * `/name` directive parser binds the skill and materialises its content as
 * a synthetic user message. `exposeToAgent` is false — the agent uses
 * `glove_read_skill` for discovery, not `glove_invoke_skill`.
 */
function wireUserDirectivesForArray(glove: FoldableGlove, skills: ContentSkill[]): void {
  for (const skill of skills) {
    glove.defineSkill({
      name: skill.name,
      description: skill.description,
      exposeToAgent: false,
      async handler() {
        return skill.content;
      },
    });
  }
}

/**
 * Same as above but for a reader-driven registry. Each `/name` invocation
 * re-reads through the reader so dynamic content stays live.
 */
function wireUserDirectivesForSummaries(
  glove: FoldableGlove,
  summaries: SkillSummary[],
  reader: SkillReader,
): void {
  for (const summary of summaries) {
    glove.defineSkill({
      name: summary.name,
      description: summary.description,
      exposeToAgent: false,
      async handler() {
        const result = await reader.read(summary.name);
        return result?.content ?? "";
      },
    });
  }
}
