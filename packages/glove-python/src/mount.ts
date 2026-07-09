/**
 * Mount the Python REPL onto a Glove agent: fold `execute_python` and prime the
 * model to discover → read → compute → act.
 */
import { z } from "zod";
import { fnSignature } from "glove-scratchpad/fns";
import type { GloveFoldArgs, IGloveRunnable } from "glove-core/glove";
import type { ToolResultData } from "glove-core/core";
import type { PySession } from "./session";

export interface PyToolOptions {
  /** Stamped into the tool-call context as the actor. */
  actor?: string;
}

/**
 * Primes the agent to treat its capabilities as functions in a persistent
 * Python REPL. The cheap, obvious move becomes: call once, compute in the REPL
 * (where the data lives), branch in the same program, and answer with the one
 * value that matters.
 */
export const PY_PREAMBLE = `Your capabilities are functions inside a persistent Python REPL. You have EXACTLY ONE tool: execute_python. Everything you do is a Python program you pass to execute_python as a "code" string. The REPL is PERSISTENT: any top-level name you bind stays available in later calls.

READ THIS FIRST — the functions listed below are NOT tools. They cannot be called directly; they exist ONLY inside an execute_python program. There is no \`github__list_pull_requests\` tool, no \`sentry__list_issues\` tool — the ONLY tool is execute_python. To use a capability you MUST wrap it:
  ✗ WRONG: call the tool github__list_pull_requests  → it does not exist, nothing happens
  ✓ RIGHT: execute_python({ code: 'len(github.list_pull_requests(state="open"))' })
If you ever find yourself with no data, it is almost always because you tried to call a capability as a tool instead of inside execute_python. Always call execute_python.

Language card (this is the WHOLE language — a Python subset; nothing else exists):
- Assignment and tuple-unpacking, def and lambda, if/elif/else, for/while (a fuel budget caps runaway loops), break/continue, try/except/finally, raise, return, f-strings, the ternary \`a if c else b\`.
- Data: ints/floats, "strings"/f"{x}", [lists], (tuples), {dicts}, {sets}, None, True/False. Comprehensions ([x for p in prs if p.is_cool]), slicing (x[1:5], x[::-1]), chained comparisons (0 < n < 10), in / not in, and/or/not, // ** % arithmetic.
- Builtins: len range enumerate zip sum min max sorted(key=,reverse=) reversed map filter any all abs round list dict set tuple str int float bool isinstance print (captured). Methods on str/list/dict/set (e.g. .upper(), .append(), .get(), .items(), .sort(key=…)).
- NO import, class, with, decorators, global/nonlocal, del, yield, async. Dunder attributes (__class__, __globals__, …) are blocked.
- Tool calls take KEYWORD arguments: github.list_pull_requests(state="open") — results are plain data (lists of dicts). Dict rows also support attribute access: p["title"] and p.title both work.

Operating discipline:
- DISCOVER before you act: fns() lists your functions; describe("name") shows one function's parameters (required ones are marked). The catalog below is already current — spend discovery calls only when unsure.
- CALL a function by name, passing its arguments as KEYWORDS: github.list_pull_requests(state="open") (or the flat form github__list_pull_requests(state="open")). The result is whatever the tool returns — usually a list of dicts, or a value.
- KNOW THE SHAPE BEFORE YOU USE IT. You do NOT know a result's field names or a field's allowed values in advance — the catalog shows a function's INPUTS, not the shape of its rows. Before you filter, sort, argmax, or read a property, inspect one row FIRST: return \`rows[0]\` or \`list(rows[0].keys())\` from an initial call (or bind \`rows = fn(...)\` and read \`rows[0]\`), then use the EXACT field names and values you saw. Guessing a field (e.g. \`.eventCount\` when the real field is \`.count\`) is a silently WRONG answer. Likewise for filters: push the constraint into the arguments (\`status="unresolved"\` — see describe) rather than fetching everything and filtering by a guessed enum value; if unsure what values a field takes, inspect the rows.
- COMPUTE in the REPL, not in your head. Counting, grouping, joining, argmax — write the expression and let the LAST expression be your answer: len(github.list_pull_requests(state="open")). Data flows between functions inside the program — it does NOT round-trip through you.
- RETURN WHAT YOU MUST REPORT. If the answer needs ids or names, return them (a count plus a small [p["id"] for p in sel] list) — never state values you did not read.
- KEEP BIG DATA OUT OF YOUR CONTEXT. \`prs = github.list_pull_requests()\` stores the rows in the REPL and echoes only a summary; then len(prs), prs[:5], [p["title"] for p in prs]. Never end a program with a huge list you don't need.
- BRANCH in one program with if/else — decide-and-act is ONE call, not a read, a look, and a second call.
- BE DECISIVE — answer in as FEW calls as possible. If a call errors, read the message, change the ONE thing it names, and retry — do not re-run the same program or thrash.
- CALLS FIRE IMMEDIATELY. Calling an effectful function performs the effect and returns its result — there is NO staging, undo, or dry run. Check parameters with describe("name") BEFORE an effectful call. If a program errors AFTER an effectful call already fired, do NOT re-run the whole program (it would repeat the effect) — fix and continue from where it failed.

The only data that enters your context is the value of the LAST expression — so return counts, small selections, or summaries, and bind the rest to a name.`;

/** A compact "here are your functions" catalog, primed so the model needn't
 *  spend a round-trip listing them (and can't guess a wrong name). */
function catalogHint(session: PySession): string {
  const fns = session.list();
  if (fns.length === 0) return "";
  const lines = fns.map((fn) => `- ${fnSignature(fn)}`);
  return `\n\nFunctions you can call INSIDE execute_python (these are not tools — signatures show INPUTS only; inspect a row for its fields):\n${lines.join("\n")}`;
}

/** Build the full preamble (language card + operating discipline + catalog). */
export function buildPyPreamble(session: PySession): string {
  return PY_PREAMBLE + catalogHint(session);
}

const inputSchema = z.object({
  code: z
    .string()
    .describe(
      "One or more Python statements. The value of the LAST expression is returned. Top-level names persist across calls.",
    ),
});

function errResult(err: unknown): ToolResultData {
  return { status: "error", message: err instanceof Error ? err.message : String(err), data: null };
}

export function buildExecutePythonTool(session: PySession, opts: PyToolOptions = {}): GloveFoldArgs<{ code: string }> {
  return {
    name: "execute_python",
    description:
      "The ONLY tool: run a Python program (the `code` string) against your capability REPL (persistent). " +
      "Your capabilities are FUNCTIONS you call INSIDE this program — they are NOT tools you can call directly. " +
      'DISCOVER: fns(), then describe("name"). ' +
      'CALL a capability by name inside the code — github.list_pull_requests(state="open") — arguments are KEYWORDS. ' +
      "INSPECT a row (list(rows[0].keys())) before filtering/sorting on a field — the signatures show inputs, not result fields; never guess a field name. " +
      "COMPUTE in the program (len / comprehensions / sorted / a dict grouping) and let the LAST expression be the answer; " +
      "top-level names keep big intermediates in the REPL across calls. " +
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

export interface MountPyConfig extends PyToolOptions {
  session: PySession;
  /** Prepend {@link PY_PREAMBLE} + the function catalog. Default true. */
  prime?: boolean;
}

/** Fold `execute_python` onto a built Glove and prime it. Returns the runnable. */
export function mountPy(glove: IGloveRunnable, config: MountPyConfig): IGloveRunnable {
  const { session, prime, ...toolOpts } = config;
  glove.fold(buildExecutePythonTool(session, toolOpts));
  if (prime !== false) {
    const existing = glove.getSystemPrompt();
    const preamble = buildPyPreamble(session);
    glove.setSystemPrompt(existing ? `${preamble}\n\n${existing}` : preamble);
  }
  return glove;
}
