/**
 * Mount the JS REPL onto a Glove agent: fold `execute_js` and prime the model to
 * discover → read → compute → act.
 */
import { z } from "zod";
import { fnSignature } from "glove-scratchpad/fns";
import type { GloveFoldArgs, IGloveRunnable } from "glove-core/glove";
import type { ToolResultData } from "glove-core/core";
import type { JsSession } from "./session";

export interface JsToolOptions {
  /** Stamped into the tool-call context as the actor. */
  actor?: string;
}

/**
 * Primes the agent to treat its capabilities as async functions in a persistent
 * JavaScript REPL. The cheap, obvious move becomes: call once, compute in the
 * REPL (where the data lives), branch in the same program, and answer with the
 * one value that matters.
 */
export const JS_PREAMBLE = `Your capabilities are functions inside a persistent JavaScript REPL. You have EXACTLY ONE tool: execute_js. Everything you do is a JavaScript program you pass to execute_js as a "code" string. The REPL is PERSISTENT: any top-level const/let you declare stays available in later calls.

READ THIS FIRST — the functions listed below are NOT tools. They cannot be called directly; they exist ONLY inside an execute_js program. There is no \`github__list_pull_requests\` tool, no \`sentry__list_issues\` tool — the ONLY tool is execute_js. To use a capability you MUST wrap it:
  ✗ WRONG: call the tool github__list_pull_requests  → it does not exist, nothing happens
  ✓ RIGHT: execute_js({ code: 'github.list_pull_requests({ state: "open" }).length' })
If you ever find yourself with no data, it is almost always because you tried to call a capability as a tool instead of inside execute_js. Always call execute_js.

Language card (this is the WHOLE language — nothing else exists):
- const/let, arrow functions and function declarations, template literals, destructuring (with defaults and ...rest), spread, optional chaining (?.), for…of / for / while (a fuel budget caps runaway loops), if/else, switch, try/catch, throw.
- Data: numbers, "strings", \`templates\`, [arrays], {objects}, null, true/false. Array methods (map/filter/reduce/find/some/every/sort/slice/flat/flatMap/includes/join/…), string methods, Object.keys/values/entries/assign/fromEntries, Math, JSON, new Set/Map/Date/RegExp, console.log (captured).
- NO class, import/require, eval, Function, this, prototypes, fetch, for…in, var. Member escapes (constructor, __proto__) are blocked.
- Tool calls: github.list_pull_requests({ state: "open" }) — results are plain data; promises resolve automatically, so \`await\` is optional.

Operating discipline:
- DISCOVER before you act: fns() lists your functions; describe("name") shows one function's parameters (required ones are marked). The catalog below is already current — spend discovery calls only when unsure.
- CALL a function by name, passing its arguments as ONE object: github.list_pull_requests({ state: "open" }) (or the flat form github__list_pull_requests({ state: "open" })). The result is whatever the tool returns — usually an array of objects, or a value.
- KNOW THE SHAPE BEFORE YOU USE IT. You do NOT know a result's field names or a field's allowed values in advance — the catalog shows a function's INPUTS, not the shape of its rows. Before you filter, sort, argmax, or read a property, inspect one row FIRST: return \`rows[0]\` or \`Object.keys(rows[0])\` from an initial call (or bind \`const rows = fn(...)\` and read \`rows[0]\`), then use the EXACT field names and values you saw. Guessing a field (e.g. \`.eventCount\` when the real field is \`.count\`) returns \`undefined\` and a silently WRONG answer — an argmax over undefined just returns the first row. Likewise for filters: push the constraint into the arguments (\`{ status: "unresolved" }\` — see describe) rather than fetching everything and filtering by a guessed enum value; if unsure what values a field takes, inspect the rows.
- COMPUTE in the REPL, not in your head. Counting, grouping, joining, argmax — write the expression and let the LAST expression be your answer: github.list_pull_requests({ state: "open" }).length. Data flows between functions inside the program — it does NOT round-trip through you.
- RETURN WHAT YOU MUST REPORT. If the answer needs ids or names, return them (a count plus a small .map(x => x.id) list) — never state values you did not read.
- KEEP BIG DATA OUT OF YOUR CONTEXT. const prs = github.list_pull_requests() stores the rows in the REPL and echoes only a summary; then prs.length, prs.slice(0, 5), prs.map(p => p.title). Never end a program with a huge array you don't need.
- BRANCH in one program with if/else — decide-and-act is ONE call, not a read, a look, and a second call.
- BE DECISIVE — answer in as FEW calls as possible. If a call errors, read the message, change the ONE thing it names, and retry — do not re-run the same program or thrash.
- CALLS FIRE IMMEDIATELY. Calling an effectful function performs the effect and returns its result — there is NO staging, undo, or dry run. Check parameters with describe("name") BEFORE an effectful call. If a program errors AFTER an effectful call already fired, do NOT re-run the whole program (it would repeat the effect) — fix and continue from where it failed.

The only data that enters your context is the value of the LAST expression — so return counts, small selections, or summaries, and bind the rest to a const.`;

/** A compact "here are your functions" catalog, primed so the model needn't
 *  spend a round-trip listing them (and can't guess a wrong name). */
function catalogHint(session: JsSession): string {
  const fns = session.list();
  if (fns.length === 0) return "";
  const lines = fns.map((fn) => `- ${fnSignature(fn)}`);
  return `\n\nFunctions you can call INSIDE execute_js (these are not tools — signatures show INPUTS only; inspect a row for its fields):\n${lines.join("\n")}`;
}

/** Build the full preamble (language card + operating discipline + catalog). */
export function buildJsPreamble(session: JsSession): string {
  return JS_PREAMBLE + catalogHint(session);
}

const inputSchema = z.object({
  code: z
    .string()
    .describe(
      "One or more JavaScript statements. The value of the LAST expression is returned. Top-level const/let persist across calls.",
    ),
});

function errResult(err: unknown): ToolResultData {
  return { status: "error", message: err instanceof Error ? err.message : String(err), data: null };
}

export function buildExecuteJsTool(session: JsSession, opts: JsToolOptions = {}): GloveFoldArgs<{ code: string }> {
  return {
    name: "execute_js",
    description:
      "The ONLY tool: run a JavaScript program (the `code` string) against your capability REPL (persistent). " +
      "Your capabilities are FUNCTIONS you call INSIDE this program — they are NOT tools you can call directly. " +
      'DISCOVER: fns(), then describe("name"). ' +
      "CALL a capability by name inside the code — github.list_pull_requests({ state: \"open\" }) — arguments go in ONE object; promises resolve automatically. " +
      "INSPECT a row (Object.keys(rows[0])) before filtering/sorting on a field — the signatures show inputs, not result fields; never guess a field name. " +
      "COMPUTE in the program (.length / .filter / .reduce / group with a Map) and let the LAST expression be the answer; " +
      "top-level const keeps big intermediates in the REPL across calls. " +
      "BRANCH inside one program with if/else — decide-and-act is one call. Calling an effectful function FIRES it immediately (no staging).",
    inputSchema,
    async do(input, _display, _glove, signal): Promise<ToolResultData> {
      try {
        const r = await session.execute(input.code, { actor: opts.actor, signal });
        return {
          status: "success",
          data: {
            value: r.value,
            ...(r.elided ? { elided: true } : {}),
            ...(r.called.length ? { called: r.called } : {}),
            ...(r.defined ? { defined: r.defined } : {}),
            ...(r.defs ? { defs: r.defs } : {}),
            ...(r.stdout ? { stdout: r.stdout } : {}),
            ...(r.note ? { note: r.note } : {}),
          },
        };
      } catch (err) {
        return errResult(err);
      }
    },
  };
}

export interface MountJsConfig extends JsToolOptions {
  session: JsSession;
  /** Prepend {@link JS_PREAMBLE} + the function catalog. Default true. */
  prime?: boolean;
}

/** Fold `execute_js` onto a built Glove and prime it. Returns the runnable. */
export function mountJs(glove: IGloveRunnable, config: MountJsConfig): IGloveRunnable {
  const { session, prime, ...toolOpts } = config;
  glove.fold(buildExecuteJsTool(session, toolOpts));
  if (prime !== false) {
    const existing = glove.getSystemPrompt();
    const preamble = buildJsPreamble(session);
    glove.setSystemPrompt(existing ? `${preamble}\n\n${existing}` : preamble);
  }
  return glove;
}
