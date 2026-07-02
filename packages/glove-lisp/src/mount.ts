/**
 * Mount the Lisp REPL onto a Glove agent: fold `execute_lisp` (+
 * `explain_lisp`) and prime the model to discover → read → compute → act.
 */
import { z } from "zod";
import type { GloveFoldArgs, IGloveRunnable } from "glove-core/glove";
import type { ToolResultData } from "glove-core/core";
import { explainProgram } from "./explain";
import type { LispSession } from "./session";

export interface LispToolOptions {
  /** Stamped into resolver context as the actor. */
  actor?: string;
  /** Allow writes through `execute_lisp`. Default false. */
  allowWrites?: boolean;
}

/**
 * Primes the agent to treat its capabilities as functions in a persistent Lisp
 * REPL. The cheap, obvious move becomes: read once, compute in the REPL (where
 * the data lives), branch in the same program, and answer with the one value
 * that matters.
 */
export const LISP_PREAMBLE = `Your capabilities are exposed as functions in a LISP REPL (Clojure-flavored). You have ONE tool, execute_lisp, and you work entirely in Lisp. The REPL is PERSISTENT: anything you (def name …) stays available in later calls.

Language card (this is the WHOLE language — nothing else exists):
- Special forms: if when cond do let if-let when-let fn defn def and or -> ->> quote stage
- Data: numbers, "strings", :keywords, [vectors], {:maps "values"}, nil, true/false. #(…) with % is fn shorthand.
- Library: map filter remove reduce count first last take drop sort-by distinct group-by frequencies max-key min-key sum avg some every? empty? contains? concat flatten range apply get get-in assoc assoc-in dissoc merge select-keys update keys vals key val juxt into set vec doall run! map-indexed str upper-case lower-case includes? starts-with? split join replace
- These work exactly as in Clojure: (sort-by :count > rows) sorts DESCENDING; (apply max-key :count rows) is argmax; (apply max-key val (frequencies xs)) is the most-common; rows OMIT nil columns, so (filter :closes_linear prs) means "has a value".
- NO loop/recur/while/eval/JS. Iteration is map/filter/reduce. A fuel budget caps runaway work.

Operating discipline:
- DISCOVER before you act: (tables) lists your resources; (describe :name) shows a resource's columns, valid values, and required arguments. The catalog below is already current — spend discovery calls only when unsure.
- READ a resource by calling it: (github_pull_requests) returns all rows as a list of maps; (github_pull_requests {:state "open"}) pushes arguments down (they are tool inputs AND filters). A vector value fans out like IN: {:channel ["a" "b"]}. Required columns are named in errors and (describe …).
- COMPUTE in the REPL, not in your head. Counting, grouping, joining, argmax — write the expression and return ONLY the final value: (count (github_pull_requests {:state "open"})). Data flows between capabilities inside the program — it does NOT round-trip through you.
- RETURN WHAT YOU MUST REPORT. If the answer needs ids or names, return them (a count plus a small (map :id …) list) — never state values you did not read.
- KEEP BIG DATA OUT OF YOUR CONTEXT. (def prs (github_pull_requests)) stores the rows in the REPL and echoes only a summary; then (count prs), (take 5 prs), (map :title prs). Never end a program with a huge list you don't need.
- BRANCH in one program. Unlike SQL, conditionals compose: (if (empty? failures) (insert! :slack_messages {…all clear…}) (insert! :emails {…alert…})) — decide-and-act is ONE call, not a read, a look, and a second call.
- BE DECISIVE — answer in as FEW calls as possible; one program that reads, computes, and acts beats many small ones. If a call errors, read the message, change the ONE thing it names, and retry — do not re-run the same program or thrash.
- ACT with (insert! :table {:col v}), (update! :table {:set} {:match}), (delete! :table {:match}). A single write FIRES IMMEDIATELY and returns its row count — that confirmation is authoritative, do NOT verify with a read. If you do re-read, your own writes are already reflected (read-your-writes).
- BULK-WRITE with ONE call: (insert! :table (map (fn [r] {:col (:x r)}) rows)) writes one row per element and returns the count — ALWAYS prefer this over per-row inserts or hand-written lists. (doseq [x xs] …) and (run! f xs) also iterate for effects.
- STAGE several writes with (stage (insert! …) (insert! …)) — nothing fires; you get a preview. Then (commit!) fires in order, or (rollback!) discards. Do not stage a single write.
- PREVIEW with explain_lisp when unsure: it reports which resources a program would touch, read vs write, and missing required arguments — without running anything.

The only data that enters your context is the value of the LAST form — so return counts, small selections, or summaries, and def the rest.`;

/** A compact "here are your resources" catalog, primed so the model needn't
 *  spend a round-trip listing them (and can't guess a wrong name). Columns that
 *  carry a description are surfaced too — that's where valid enum values live. */
function catalogHint(session: LispSession): string {
  const tables = session.list();
  if (tables.length === 0) return "";
  const lines = tables.map((t) => {
    const described = t.columns.filter((c) => c.description).map((c) => `${c.name} (${c.description})`);
    const detail = described.length ? `\n    columns — ${described.join("; ")}` : "";
    return `- ${t.name}: ${t.description ?? t.name}${detail}`;
  });
  return `\n\nResources available to you (use exact values as shown; run (describe :name) for full column lists):\n${lines.join("\n")}`;
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

export function buildExecuteLispTool(session: LispSession, opts: LispToolOptions = {}): GloveFoldArgs<{ code: string }> {
  return {
    name: "execute_lisp",
    description:
      "Run a Lisp program against your capability REPL (Clojure-flavored, persistent). Your tools ARE functions. " +
      "DISCOVER: (tables), then (describe :name). " +
      "READ a capability by calling it — (github_pull_requests {:state \"open\"}) — arguments push down as a {:col value} map. " +
      "COMPUTE in the program (count/filter/group-by/max-key) and return only the final value; " +
      "(def name …) keeps big intermediates in the REPL across calls. " +
      "BRANCH inside one program with if/cond — decide-and-act is one call. " +
      "ACT with (insert! :table {…}) / (update! …) / (delete! …); STAGE several writes with (stage …) then (commit!), or (rollback!) for a dry run.",
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

export function buildExplainLispTool(session: LispSession): GloveFoldArgs<{ code: string }> {
  return {
    name: "explain_lisp",
    description:
      "Preview which resources a Lisp program would touch (read vs write, volatility, missing required arguments, unknown names) WITHOUT running it. Use it to validate a program — especially before writes.",
    inputSchema,
    async do(input): Promise<ToolResultData> {
      try {
        const resources = new Map(session.list().map((r) => [r.name, r]));
        const known = new Set<string>([...BUILTIN_NAMES, ...session.definitions()]);
        return { status: "success", data: explainProgram(input.code, resources, known) };
      } catch (err) {
        return errResult(err);
      }
    },
  };
}

// Kept in sync with stdlib.ts + session surface; used by explain_lisp to avoid
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
  "tables", "describe", "insert!", "update!", "delete!", "commit!", "rollback!",
];

export interface MountLispConfig extends LispToolOptions {
  session: LispSession;
  /** Prepend {@link LISP_PREAMBLE} + the resource catalog. Default true. */
  prime?: boolean;
  /** Also fold `explain_lisp`. Default true. */
  explain?: boolean;
}

/** Fold the REPL tool(s) onto a built Glove and prime it. Returns the runnable. */
export function mountLisp(glove: IGloveRunnable, config: MountLispConfig): IGloveRunnable {
  const { session, prime, explain, ...toolOpts } = config;
  glove.fold(buildExecuteLispTool(session, toolOpts));
  if (explain !== false) glove.fold(buildExplainLispTool(session));
  if (prime !== false) {
    const existing = glove.getSystemPrompt();
    const preamble = LISP_PREAMBLE + catalogHint(session);
    glove.setSystemPrompt(existing ? `${preamble}\n\n${existing}` : preamble);
  }
  return glove;
}
