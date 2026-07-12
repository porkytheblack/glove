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
- DISCOVER before you act: search("what you want") jumps to matching functions; servers() lists your capability servers, fns("server") lists that server's functions, describe("name") shows one function's parameters + result shape (required ones are marked) — the same tiers exist as the tools search_functions / list_servers / list_functions / describe_function. See the discovery note below.
- CALL a function by name, passing its arguments as KEYWORDS: github.list_pull_requests(state="open") (or the flat form github__list_pull_requests(state="open")). The result is whatever the tool returns — usually a list of dicts, or a value.
- KNOW THE SHAPE BEFORE YOU USE IT. You do NOT know a result's field names or a field's allowed values in advance — the catalog shows a function's INPUTS, not the shape of its rows. Before you filter, sort, argmax, or read a property, inspect one row FIRST: return \`rows[0]\` or \`list(rows[0].keys())\` from an initial call (or bind \`rows = fn(...)\` and read \`rows[0]\`), then use the EXACT field names and values you saw. Guessing a field (e.g. \`.eventCount\` when the real field is \`.count\`) is a silently WRONG answer. Likewise for filters: push the constraint into the arguments (\`status="unresolved"\` — see describe) rather than fetching everything and filtering by a guessed enum value; if unsure what values a field takes, inspect the rows.
- COMPUTE in the REPL, not in your head. Counting, grouping, joining, argmax — write the expression and let the LAST expression be your answer: len(github.list_pull_requests(state="open")). Data flows between functions inside the program — it does NOT round-trip through you.
- RETURN WHAT YOU MUST REPORT. If the answer needs ids or names, return them (a count plus a small [p["id"] for p in sel] list) — never state values you did not read.
- KEEP BIG DATA OUT OF YOUR CONTEXT. \`prs = github.list_pull_requests()\` stores the rows in the REPL and echoes only a summary; then len(prs), prs[:5], [p["title"] for p in prs]. Never end a program with a huge list you don't need.
- BRANCH in one program with if/else — decide-and-act is ONE call, not a read, a look, and a second call.
- BE DECISIVE — answer in as FEW calls as possible. If a call errors, read the message, change the ONE thing it names, and retry — do not re-run the same program or thrash.
- CALLS FIRE IMMEDIATELY. Calling an effectful function performs the effect and returns its result — there is NO staging, undo, or dry run. Check parameters with describe("name") BEFORE an effectful call. If a program errors AFTER an effectful call already fired, do NOT re-run the whole program (it would repeat the effect) — fix and continue from where it failed.

The only data that enters your context is the value of the LAST expression — so return counts, small selections, or summaries, and bind the rest to a name.`;

/** How the capability catalog reaches the model.
 *  - `progressive` (default): nothing is listed — the model discovers servers →
 *    functions → schemas via the discovery tools / REPL builtins. Scales to
 *    hundreds of tools without a fixed context cost.
 *  - `full`: every function signature is primed into the prompt (best for small
 *    catalogs — no discovery round-trip).
 *  - `auto`: `full` below {@link AUTO_FULL_MAX_FNS} functions, else `progressive`. */
export type DiscoveryMode = "progressive" | "full" | "auto";

const AUTO_FULL_MAX_FNS = 40;

function resolveMode(mode: DiscoveryMode | undefined, session: PySession): "progressive" | "full" {
  const m = mode ?? "progressive";
  if (m === "auto") return session.list().length <= AUTO_FULL_MAX_FNS ? "full" : "progressive";
  return m;
}

/** The catalog hint — a full signature dump, or (progressive) just the discovery
 *  path and the server/function counts, so nothing scales into the prompt. */
function catalogHint(session: PySession, mode: "progressive" | "full"): string {
  const fns = session.list();
  if (fns.length === 0) return "";
  if (mode === "full") {
    const lines = fns.map((fn) => `- ${fnSignature(fn)}`);
    return `\n\nFunctions you can call INSIDE execute_python (these are not tools — signatures show INPUTS only; inspect a row for its fields):\n${lines.join("\n")}`;
  }
  const servers = session.discoverServers();
  return `\n\nDISCOVER YOUR CAPABILITIES — they are NOT listed here. You have ${fns.length} functions across ${servers.length} servers; find the few you need:
- FASTEST: search_functions(query="open pull requests") — jump straight to the matching functions when you know what you want.
- Or browse: list_servers() → list_functions(server="github") → describe_function(name="github__list_pull_requests") for parameters + result shape.
Each is available BOTH as a tool AND inside execute_python (as search("…") / servers() / fns("github") / describe("name")). A capable model can script the sweep in one program — e.g. [f for f in search("send email")] — or fire the discovery tools in a batch first, then write one program. describe() a function before filtering on a field (it shows the row shape). Call a function by its name once you know it.`;
}

/** Build the preamble (language card + operating discipline + catalog hint). */
export function buildPyPreamble(session: PySession, mode: "progressive" | "full" = "progressive"): string {
  return PY_PREAMBLE + catalogHint(session, mode);
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
      'DISCOVER: search_functions("what you want") jumps to matching functions, or browse list_servers → list_functions(server) → describe_function(name) (as tools), or search()/servers()/fns("server")/describe("name") inside the code. ' +
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

/** The native discovery tools — the same tiers as the REPL builtins
 *  (`search()` / `servers()` / `fns(server)` / `describe(name)`), so a model that
 *  prefers a batch of tool calls can gather what it needs before writing any code. */
export function buildDiscoveryTools(
  session: PySession,
): [GloveFoldArgs<{ query: string }>, GloveFoldArgs<Record<string, never>>, GloveFoldArgs<{ server: string }>, GloveFoldArgs<{ name: string }>] {
  return [
    {
      name: "search_functions",
      description:
        "Discovery: jump straight to the functions matching a free-text query (e.g. \"open pull requests\") — the fast path when you know what you want but not which server. Also available in the REPL as search(\"query\").",
      inputSchema: z.object({ query: z.string().describe('What you want to do, e.g. "send email" or "list open PRs".') }),
      async do(input: { query: string }): Promise<ToolResultData> {
        return { status: "success", data: session.searchFunctions(input.query) };
      },
    },
    {
      name: "list_servers",
      description:
        "Discovery tier 1: list your capability servers (MCP namespaces) with how many functions each exposes. Then list_functions for one. Also available inside execute_python as servers().",
      inputSchema: z.object({}),
      async do(): Promise<ToolResultData> {
        return { status: "success", data: session.discoverServers() };
      },
    },
    {
      name: "list_functions",
      description:
        "Discovery tier 2: list one server's functions and their input signatures. Then describe_function for a full schema, or just call the function inside execute_python. Also available in the REPL as fns(\"server\").",
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
        "Discovery tier 3: the full parameters + result shape of one function. Also available in the REPL as describe(\"name\").",
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

export interface MountPyConfig extends PyToolOptions {
  session: PySession;
  /** Prepend {@link PY_PREAMBLE} + the catalog hint. Default true. */
  prime?: boolean;
  /**
   * How the catalog reaches the model. Default `progressive` — nothing is
   * listed; the model discovers servers → functions → schemas. See
   * {@link DiscoveryMode}.
   */
  discovery?: DiscoveryMode;
}

/** Fold `execute_python` + the discovery tools onto a built Glove and prime it. */
export function mountPy(glove: IGloveRunnable, config: MountPyConfig): IGloveRunnable {
  const { session, prime, discovery, ...toolOpts } = config;
  glove.fold(buildExecutePythonTool(session, toolOpts));
  // Discovery tools are always available (weak models batch them; strong models
  // may prefer the REPL builtins) — they carry no per-function context cost.
  for (const tool of buildDiscoveryTools(session)) glove.fold(tool as GloveFoldArgs<unknown>);
  if (prime !== false) {
    const mode = resolveMode(discovery, session);
    const existing = glove.getSystemPrompt();
    const preamble = buildPyPreamble(session, mode);
    glove.setSystemPrompt(existing ? `${preamble}\n\n${existing}` : preamble);
  }
  return glove;
}
