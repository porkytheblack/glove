/**
 * Mount the Lisp surface onto a Glove agent: fold the eval tool (+ its explain
 * companion) and prime the model to discover → read → compute → act.
 *
 * Ships THREE interchangeable framings of the same eval tool, chosen at mount
 * time with `frame`:
 *   - `"repl"` (default) — persistent REPL. Tools `execute_lisp` / `explain_lisp`.
 *   - `"program"` — complete-program framing. Tools `execute_lisp_program` /
 *     `explain_lisp_program`.
 *   - `"workflow"` — one-shot-workflow framing that de-REPLs the priming (author
 *     the WHOLE task as one program). Tools `execute_lisp_workflow` /
 *     `explain_lisp_workflow`.
 *
 * The runtime is identical across framings — only the tool NAMES and the priming
 * change. See the bench's FRAME-PAPER for the rationale.
 */
import { z } from "zod";
import { describeFn } from "glove-scratchpad";
import type { GloveFoldArgs, IGloveRunnable } from "glove-core/glove";
import type { ToolResultData } from "glove-core/core";
import { explainProgram } from "./explain";
import type { LispSession } from "./session";

/** Which framing of the eval tool to mount. See the module doc. */
export type Frame = "repl" | "program" | "workflow";

/** The eval tool's name for a framing (`execute_lisp` / `_program` / `_workflow`). */
export function lispToolName(frame: Frame = "repl"): string {
  return frame === "program" ? "execute_lisp_program" : frame === "workflow" ? "execute_lisp_workflow" : "execute_lisp";
}

/** The explain tool's name for a framing. */
export function lispExplainName(frame: Frame = "repl"): string {
  return frame === "program" ? "explain_lisp_program" : frame === "workflow" ? "explain_lisp_workflow" : "explain_lisp";
}

export interface LispToolOptions {
  /** Stamped into resolver context as the actor. */
  actor?: string;
  /** Allow writes through the eval tool. Default false. */
  allowWrites?: boolean;
  /** Which framing to mount. Default `"repl"`. */
  frame?: Frame;
}

const unitWord = (frame: Frame): string => (frame === "workflow" ? "workflow" : "program");

/** The head paragraph — the mental model the framing hands the model. */
function head(frame: Frame, tool: string): string {
  if (frame === "workflow") {
    return `You accomplish tasks by authoring WORKFLOWS in Lisp (Clojure-flavored). You have ONE tool, ${tool}. A workflow is ONE complete Lisp program that carries a task from start to finish — discover, read, compute, branch, and act — in a SINGLE call. This is NOT an interactive prompt: do not run one form and wait to see the result. Compose the WHOLE task as one program and let only the final form's value return. Think "write the script", not "type at a REPL".`;
  }
  if (frame === "program") {
    return `You accomplish tasks by writing COMPLETE Lisp programs (Clojure-flavored). You have ONE tool, ${tool}. Each call runs one self-contained program and returns the value of its last form. Compose a whole step — discover, read, compute, and act — as ONE program rather than a form at a time.`;
  }
  return `Your capabilities are exposed as functions in a LISP REPL (Clojure-flavored). You have ONE tool, ${tool}, and you work entirely in Lisp. The REPL is PERSISTENT: anything you (def name …) stays available in later calls.`;
}

/** How cross-call persistence reads — "split freely" (repl) vs "retry only". */
function persistence(frame: Frame): string {
  if (frame === "workflow") {
    return `\n\nAnything you (def name …) survives into later calls — but treat that only as a RECOVERY aid: if a workflow fails partway (e.g. after a write fired), continue from where it stopped without recomputing the expensive prefix. Never split a task across calls on purpose — collapsing it into one workflow is exactly what this surface is for.`;
  }
  if (frame === "program") {
    return `\n\nAnything you (def name …) persists across calls if you need it, but prefer to finish a task in one program.`;
  }
  return "";
}

function decisiveBullet(frame: Frame): string {
  if (frame === "workflow") {
    return `- BE DECISIVE — the target is ONE workflow per task; one program that reads, computes, branches, and acts beats a handful of small ones. If a workflow errors, read the message, change the ONE thing it names, and re-author the remaining forms — do not re-run an unchanged program or thrash.`;
  }
  if (frame === "program") {
    return `- BE DECISIVE — aim for ONE program per task; one program that reads, computes, and acts beats many small ones. If a call errors, read the message, change the ONE thing it names, and retry — do not re-run the same program or thrash.`;
  }
  return `- BE DECISIVE — answer in as FEW calls as possible; one program that reads, computes, and acts beats many small ones. If a call errors, read the message, change the ONE thing it names, and retry — do not re-run the same program or thrash.`;
}

const LISP_LANG_CARD = `Language card (this is the WHOLE language — nothing else exists):
- Special forms: if when cond do let if-let when-let fn defn def and or -> ->> quote stage
- Data: numbers, "strings", :keywords, [vectors], {:maps "values"}, nil, true/false. #(…) with % is fn shorthand.
- Library: map filter remove reduce count first last take drop sort-by distinct group-by frequencies max-key min-key sum avg some every? empty? contains? concat flatten range apply get get-in assoc assoc-in dissoc merge select-keys update keys vals key val juxt into set vec doall run! map-indexed str upper-case lower-case includes? starts-with? split join replace
- These work exactly as in Clojure: (sort-by :count > rows) sorts DESCENDING; (apply max-key :count rows) is argmax; (apply max-key val (frequencies xs)) is the most-common; rows OMIT nil columns, so (filter :closes_linear prs) means "has a value".
- NO loop/recur/while/eval/JS. Iteration is map/filter/reduce. A fuel budget caps runaway work.`;

const LISP_FN_LANG_CARD = `Language card (this is the WHOLE language — nothing else exists):
- Special forms: if when cond do let if-let when-let fn defn def and or -> ->> quote
- Data: numbers, "strings", :keywords, [vectors], {:maps "values"}, nil, true/false. #(…) with % is fn shorthand.
- Library: map filter remove reduce count first last take drop sort-by distinct group-by frequencies max-key min-key sum avg some every? empty? contains? concat flatten range apply get get-in assoc assoc-in dissoc merge select-keys update keys vals key val juxt into set vec doall run! map-indexed str upper-case lower-case includes? starts-with? split join replace
- These work exactly as in Clojure: (sort-by :count > rows) sorts DESCENDING; (apply max-key :count rows) is argmax; (apply max-key val (frequencies xs)) is the most-common.
- NO loop/recur/while/eval/JS. Iteration is map/filter/reduce. A fuel budget caps runaway work.`;

/**
 * Resource-mode preamble (ResourceTable). Capabilities are functions over tables;
 * arguments push down, writes stage. Frame-parameterized.
 */
export function buildLispResourcePreamble(frame: Frame = "repl"): string {
  const tool = lispToolName(frame);
  const explain = lispExplainName(frame);
  const unit = unitWord(frame);
  return `${head(frame, tool)}${persistence(frame)}

${LISP_LANG_CARD}

Operating discipline:
- DISCOVER before you act: (tables) lists your resources; (describe :name) shows a resource's columns, valid values, and required arguments. The catalog below is already current — spend discovery calls only when unsure.
- READ a resource by calling it: (github_pull_requests) returns all rows as a list of maps; (github_pull_requests {:state "open"}) pushes arguments down (they are tool inputs AND filters). A vector value fans out like IN: {:channel ["a" "b"]}. Required columns are named in errors and (describe …).
- COMPUTE in the ${unit}, not in your head. Counting, grouping, joining, argmax — write the expression and return ONLY the final value: (count (github_pull_requests {:state "open"})). Data flows between capabilities inside the ${unit} — it does NOT round-trip through you.
- RETURN WHAT YOU MUST REPORT. If the answer needs ids or names, return them (a count plus a small (map :id …) list) — never state values you did not read.
- KEEP BIG DATA OUT OF YOUR CONTEXT. (def prs (github_pull_requests)) stores the rows in the ${unit} and echoes only a summary; then (count prs), (take 5 prs), (map :title prs). Never end a ${unit} with a huge list you don't need.
- BRANCH in one ${unit}. Unlike SQL, conditionals compose: (if (empty? failures) (insert! :slack_messages {…all clear…}) (insert! :emails {…alert…})) — decide-and-act is ONE call, not a read, a look, and a second call.
${decisiveBullet(frame)}
- ACT with (insert! :table {:col v}), (update! :table {:set} {:match}), (delete! :table {:match}). A single write FIRES IMMEDIATELY and returns its row count — that confirmation is authoritative, do NOT verify with a read. If you do re-read, your own writes are already reflected (read-your-writes).
- BULK-WRITE with ONE call: (insert! :table (map (fn [r] {:col (:x r)}) rows)) writes one row per element and returns the count — ALWAYS prefer this over per-row inserts or hand-written lists. (doseq [x xs] …) and (run! f xs) also iterate for effects.
- STAGE several writes with (stage (insert! …) (insert! …)) — nothing fires; you get a preview. Then (commit!) fires in order, or (rollback!) discards. Do not stage a single write.
- PREVIEW with ${explain} when unsure: it reports which resources a ${unit} would touch, read vs write, and missing required arguments — without running anything.

The only data that enters your context is the value of the LAST form — so return counts, small selections, or summaries, and def the rest.`;
}

/**
 * Function-mode preamble (no ResourceTable). Capabilities are plain functions;
 * a call fires when its form evaluates. Frame-parameterized.
 */
export function buildLispFnPreamble(frame: Frame = "repl"): string {
  const tool = lispToolName(frame);
  const unit = unitWord(frame);
  return `${head(frame, tool)}${persistence(frame)}

${LISP_FN_LANG_CARD}

Operating discipline:
- DISCOVER before you act: (fns) lists your functions; (describe :name) shows one function's parameters (required ones are marked). The catalog below is already current — spend discovery calls only when unsure.
- CALL a function by name, passing its arguments as ONE map: (github__list_pull_requests {:state "open"}). Argument names and required ones come from (describe :name). The result is whatever the tool returns — usually a list of maps or a value.
- COMPUTE in the ${unit}, not in your head. Counting, grouping, joining, argmax — write the expression and return ONLY the final value: (count (github__list_pull_requests {:state "open"})). Data flows between functions inside the ${unit} — it does NOT round-trip through you.
- RETURN WHAT YOU MUST REPORT. If the answer needs ids or names, return them (a count plus a small (map :id …) list) — never state values you did not read.
- KEEP BIG DATA OUT OF YOUR CONTEXT. (def prs (github__list_pull_requests)) stores the rows in the ${unit} and echoes only a summary; then (count prs), (take 5 prs), (map :title prs). Never end a ${unit} with a huge list you don't need.
- BRANCH in one ${unit}. Conditionals compose: (if (empty? incidents) (slack__post {…all clear…}) (email__send {…alert…})) — decide-and-act is ONE call, not a read, a look, and a second call.
${decisiveBullet(frame)}
- CALLS FIRE IMMEDIATELY. Calling an effectful function performs the effect and returns its result — there is NO staging, undo, or dry run. Check parameters with (describe :name) BEFORE an effectful call. If a ${unit} errors AFTER an effectful call already fired, do NOT re-run the whole ${unit} (it would repeat the effect) — fix and continue from where it failed.

The only data that enters your context is the value of the LAST form — so return counts, small selections, or summaries, and def the rest.`;
}

/**
 * The classic REPL preambles, kept as exported constants for backward
 * compatibility. Equivalent to `buildLisp{Resource,Fn}Preamble("repl")`.
 */
export const LISP_PREAMBLE = buildLispResourcePreamble("repl");
export const LISP_FN_PREAMBLE = buildLispFnPreamble("repl");

/** Appended after the resource preamble when a session has BOTH resources and
 *  functions, so the resource-mode agent also knows the function surface. */
export const LISP_FN_SECTION = `Some capabilities are exposed as FUNCTIONS (alongside the resources above). Discover them with (fns) and (describe :name); call one by passing its arguments as a map — (github__list_pull_requests {:state "open"}) — and it returns the tool's data directly. Functions have NO pushdown and NO staging: an effectful function fires the moment it is called.`;

/** How the function catalog reaches the model — see glove-python's
 *  {@link DiscoveryMode}. `progressive` (default) lists nothing; the model
 *  discovers servers → functions → schemas. Resources (table mode) are
 *  unaffected — they always list. */
export type DiscoveryMode = "progressive" | "full" | "auto";

const AUTO_FULL_MAX_FNS = 40;

function resolveMode(mode: DiscoveryMode | undefined, session: LispSession): "progressive" | "full" {
  const m = mode ?? "progressive";
  if (m === "auto") return session.listFns().length <= AUTO_FULL_MAX_FNS ? "full" : "progressive";
  return m;
}

/** A compact catalog of the session's resources AND functions, primed so the
 *  model needn't spend a round-trip listing them (and can't guess a wrong name).
 *  In `progressive` mode the FUNCTION section is replaced by a discovery path. */
function catalogHint(session: LispSession, mode: "progressive" | "full"): string {
  const sections: string[] = [];
  const tables = session.list();
  if (tables.length > 0) {
    const lines = tables.map((t) => {
      const described = t.columns.filter((c) => c.description).map((c) => `${c.name} (${c.description})`);
      const detail = described.length ? `\n    columns — ${described.join("; ")}` : "";
      return `- ${t.name}: ${t.description ?? t.name}${detail}`;
    });
    sections.push(
      `Resources available to you (use exact values as shown; run (describe :name) for full column lists):\n${lines.join("\n")}`,
    );
  }
  const fns = session.listFns();
  if (fns.length > 0 && mode === "full") {
    const lines = fns.map((fn) => {
      const d = describeFn(fn);
      const params = d.params
        .map((p) => `:${p.name}${p.required ? "" : "?"}${p.enum ? ` (${p.enum.map((e) => JSON.stringify(e)).join("|")})` : ""}`)
        .join(" ");
      const desc = fn.description?.split("\n", 1)[0]?.trim();
      const returns = d.returns ? ` → ${d.returns}` : "";
      return `- (${fn.name}${params ? ` {${params}}` : ""})${returns}${desc ? ` — ${desc}` : ""}`;
    });
    sections.push(
      `Functions available to you (call by name with an argument map; a row's fields are shown after →; run (describe :name) for details):\n${lines.join("\n")}`,
    );
  } else if (fns.length > 0) {
    const servers = session.discoverServers();
    sections.push(
      `DISCOVER YOUR FUNCTIONS — they are NOT listed here. ${fns.length} functions across ${servers.length} servers; find the few you need:\n` +
        `- FASTEST: (search "open pull requests") — jump straight to the matching functions.\n` +
        `- Or browse: (servers) → (fns :github) → (describe :github__list_pull_requests) for parameters + result shape.\n` +
        `Each is also a tool (search_functions / list_servers / list_functions / describe_function) you can fire in a batch — and those same names work INSIDE the code too, as aliases of (search …)/(servers)/(fns …)/(describe …): e.g. (list_functions :github) or (search_functions "send email"). (describe :name) before filtering on a field (it shows the row shape). Then call a function by name: (github__list_pull_requests {…}).`,
    );
  }
  return sections.length ? `\n\n${sections.join("\n\n")}` : "";
}

/** Select the preamble that fits the session's surface: functions-only,
 *  resources-only, or both. */
export function buildLispPreamble(
  session: LispSession,
  mode: "progressive" | "full" = "progressive",
  frame: Frame = "repl",
): string {
  const hasResources = session.list().length > 0;
  const hasFns = session.listFns().length > 0;
  let base = buildLispResourcePreamble(frame);
  if (hasFns && !hasResources) base = buildLispFnPreamble(frame);
  else if (hasFns) base = `${buildLispResourcePreamble(frame)}\n\n${LISP_FN_SECTION}`;
  return base + catalogHint(session, mode);
}

const inputSchema = z.object({
  code: z
    .string()
    .describe(
      "One or more Lisp forms. The value of the LAST form is returned. (def name …) persists across calls.",
    ),
});

function errResult(err: unknown): ToolResultData {
  return { status: "error", message: err instanceof Error ? err.message : String(err), data: null };
}

function toolDescription(frame: Frame): string {
  const unit = unitWord(frame);
  const lead =
    frame === "workflow"
      ? `Author a WORKFLOW — one complete Lisp program (Clojure-flavored) that carries the whole task from discovery to answer in a single call, against your persistent capability session. `
      : frame === "program"
        ? `Run a complete Lisp program (Clojure-flavored, persistent) against your capability session. `
        : `Run a Lisp program against your capability REPL (Clojure-flavored, persistent). `;
  return (
    lead +
    "Your tools ARE functions. " +
    "DISCOVER: (tables), then (describe :name). " +
    "READ a capability by calling it — (github_pull_requests {:state \"open\"}) — arguments push down as a {:col value} map. " +
    `COMPUTE in the ${unit} (count/filter/group-by/max-key) and return only the final value; ` +
    "(def name …) keeps big intermediates across calls. " +
    `BRANCH inside one ${unit} with if/cond — decide-and-act is one call. ` +
    "ACT with (insert! :table {…}) / (update! …) / (delete! …); STAGE several writes with (stage …) then (commit!), or (rollback!) for a dry run."
  );
}

export function buildExecuteLispTool(session: LispSession, opts: LispToolOptions = {}): GloveFoldArgs<{ code: string }> {
  const frame = opts.frame ?? "repl";
  const tool = lispToolName(frame);
  return {
    name: tool,
    description: toolDescription(frame),
    inputSchema,
    async do(input, _display, _glove, signal): Promise<ToolResultData> {
      try {
        const r = await session.execute(input.code, {
          allowWrites: opts.allowWrites,
          actor: opts.actor,
          signal,
        });
        return {
          status: "success",
          data: {
            value: r.value,
            ...(r.elided ? { elided: true } : {}),
            ...(r.defined ? { defined: r.defined } : {}),
            ...(r.defs ? { defs: r.defs } : {}),
            ...(r.stdout ? { stdout: r.stdout } : {}),
            ...(r.message ? { message: r.message } : {}),
            ...(r.staged ? { staged: r.staged } : {}),
            ...(r.note ? { note: r.note } : {}),
          },
        };
      } catch (err) {
        return errResult(err);
      }
    },
  };
}

export function buildExplainLispTool(session: LispSession, opts: LispToolOptions = {}): GloveFoldArgs<{ code: string }> {
  const frame = opts.frame ?? "repl";
  const tool = lispToolName(frame);
  return {
    name: lispExplainName(frame),
    description:
      `Preview which resources a Lisp ${unitWord(frame)} would touch (read vs write, volatility, missing required arguments, unknown names) WITHOUT running it. Use it to validate a ${unitWord(frame)} — especially before writes; a companion to ${tool}.`,
    inputSchema,
    async do(input): Promise<ToolResultData> {
      try {
        const resources = new Map(session.list().map((r) => [r.name, r]));
        const known = new Set<string>([
          ...BUILTIN_NAMES,
          ...session.listFns().map((f) => f.name),
          ...session.definitions(),
        ]);
        return { status: "success", data: explainProgram(input.code, resources, known) };
      } catch (err) {
        return errResult(err);
      }
    },
  };
}

// Kept in sync with stdlib.ts + session surface; used by explain to avoid
// flagging library calls as unknown. (A stale entry only affects explain output.)
const BUILTIN_NAMES = [
  "+", "-", "*", "/", "mod", "inc", "dec", "abs", "round", "floor", "ceil", "max", "min",
  "<", "<=", ">", ">=", "=", "not=", "not", "nil?", "some?", "boolean", "identity",
  "count", "first", "last", "rest", "nth", "take", "drop", "reverse", "concat", "flatten", "range",
  "empty?", "not-empty", "map", "mapcat", "filter", "remove", "reduce", "some", "every?",
  "take-while", "drop-while", "sort", "sort-by", "distinct", "group-by", "frequencies",
  "max-key", "min-key", "max-by", "min-by", "sum", "avg", "contains?", "zipmap", "apply", "comp", "partial",
  "get", "get-in", "assoc", "dissoc", "merge", "select-keys", "update", "keys", "vals",
  "str", "upper-case", "lower-case", "capitalize", "trim", "includes?", "starts-with?", "ends-with?",
  "split", "join", "replace", "subs", "println", "prn", "print",
  "tables", "fns", "describe", "insert!", "update!", "delete!", "commit!", "rollback!",
];

/** The three native discovery tools — the same tiers as the REPL builtins
 *  (`(servers)` / `(fns :server)` / `(describe :name)`), for models that prefer a
 *  batch of tool calls before writing code. Only relevant when the session has
 *  functions (fn mode). */
export function buildDiscoveryTools(
  session: LispSession,
): [GloveFoldArgs<{ query: string }>, GloveFoldArgs<Record<string, never>>, GloveFoldArgs<{ server: string }>, GloveFoldArgs<{ name: string }>] {
  return [
    {
      name: "search_functions",
      description:
        "Discovery: jump straight to the functions matching a free-text query (e.g. \"open pull requests\"). Also available in the eval program as (search \"query\").",
      inputSchema: z.object({ query: z.string().describe('What you want to do, e.g. "send email".') }),
      async do(input: { query: string }): Promise<ToolResultData> {
        return { status: "success", data: session.searchFunctions(input.query) };
      },
    },
    {
      name: "list_servers",
      description:
        "Discovery tier 1: list your capability servers (MCP namespaces) with how many functions each exposes. Also available in the eval program as (servers).",
      inputSchema: z.object({}),
      async do(): Promise<ToolResultData> {
        return { status: "success", data: session.discoverServers() };
      },
    },
    {
      name: "list_functions",
      description:
        "Discovery tier 2: list one server's functions and their argument keywords. Also available in the eval program as (fns :server).",
      inputSchema: z.object({ server: z.string().describe('A server name from list_servers, e.g. "github".') }),
      async do(input: { server: string }): Promise<ToolResultData> {
        try {
          return { status: "success", data: session.discoverFunctions(input.server) };
        } catch (err) {
          return errResult(err);
        }
      },
    },
    {
      name: "describe_function",
      description:
        "Discovery tier 3: the full parameters + result shape of one function. Also available in the eval program as (describe :name).",
      inputSchema: z.object({ name: z.string().describe('A function name, e.g. "github__list_pull_requests".') }),
      async do(input: { name: string }): Promise<ToolResultData> {
        try {
          return { status: "success", data: await session.describeFunction(input.name) };
        } catch (err) {
          return errResult(err);
        }
      },
    },
  ];
}

export interface MountLispConfig extends LispToolOptions {
  session: LispSession;
  /** Prepend the preamble + the resource catalog. Default true. */
  prime?: boolean;
  /** Also fold the explain tool. Default true. */
  explain?: boolean;
  /** How the FUNCTION catalog reaches the model (fn mode). Default `progressive`. See {@link DiscoveryMode}. */
  discovery?: DiscoveryMode;
}

/** Fold the eval tool(s) onto a built Glove and prime it. Returns the runnable. */
export function mountLisp(glove: IGloveRunnable, config: MountLispConfig): IGloveRunnable {
  const { session, prime, explain, discovery, ...toolOpts } = config;
  const frame = toolOpts.frame ?? "repl";
  glove.fold(buildExecuteLispTool(session, toolOpts));
  if (explain !== false) glove.fold(buildExplainLispTool(session, toolOpts));
  // Discovery tools only make sense when there are functions to discover.
  if (session.listFns().length > 0) {
    for (const tool of buildDiscoveryTools(session)) glove.fold(tool as GloveFoldArgs<unknown>);
  }
  if (prime !== false) {
    const mode = resolveMode(discovery, session);
    const existing = glove.getSystemPrompt();
    const preamble = buildLispPreamble(session, mode, frame);
    glove.setSystemPrompt(existing ? `${preamble}\n\n${existing}` : preamble);
  }
  return glove;
}
