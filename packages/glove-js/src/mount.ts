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

/** How the capability catalog reaches the model — see glove-python's
 *  {@link DiscoveryMode} for the full rationale. `progressive` (default) lists
 *  nothing and the model discovers servers → functions → schemas. */
export type DiscoveryMode = "progressive" | "full" | "auto";

const AUTO_FULL_MAX_FNS = 40;

function resolveMode(mode: DiscoveryMode | undefined, session: JsSession): "progressive" | "full" {
  const m = mode ?? "progressive";
  if (m === "auto") return session.list().length <= AUTO_FULL_MAX_FNS ? "full" : "progressive";
  return m;
}

/** The catalog hint — a full signature dump, or (progressive) just the discovery
 *  path + the server/function counts, so nothing scales into the prompt. */
function catalogHint(session: JsSession, mode: "progressive" | "full"): string {
  const fns = session.list();
  if (fns.length === 0) return "";
  if (mode === "full") {
    const lines = fns.map((fn) => `- ${fnSignature(fn)}`);
    return `\n\nFunctions you can call INSIDE execute_js (these are not tools — signatures show INPUTS only; inspect a row for its fields):\n${lines.join("\n")}`;
  }
  const servers = session.discoverServers();
  return `\n\nDISCOVER YOUR CAPABILITIES — they are NOT listed here. You have ${fns.length} functions across ${servers.length} servers; find the few you need progressively:
1. list_servers() — the servers and how many functions each exposes.
2. list_functions({ server: "github" }) — that server's function signatures.
3. describe_function({ name: "github__list_pull_requests" }) — one function's parameters + result shape.
Each is available BOTH as a tool AND inside execute_js (as servers() / fns("github") / describe("name")). A capable model can script the whole sweep in one program — e.g. servers().map(s => fns(s.name)) — or fire the discovery tools in a batch first, then write one program. Call a function by its name once you know it.`;
}

/** Build the preamble (language card + operating discipline + catalog hint). */
export function buildJsPreamble(session: JsSession, mode: "progressive" | "full" = "progressive"): string {
  return JS_PREAMBLE + catalogHint(session, mode);
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
      'DISCOVER progressively: list_servers → list_functions({ server }) → describe_function({ name }) (as tools), or servers()/fns("server")/describe("name") inside the code. ' +
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

/** The three native discovery tools — the same tiers as the REPL builtins
 *  (`servers()` / `fns(server)` / `describe(name)`). */
export function buildDiscoveryTools(session: JsSession): Array<GloveFoldArgs<Record<string, never>> | GloveFoldArgs<{ server: string }> | GloveFoldArgs<{ name: string }>> {
  return [
    {
      name: "list_servers",
      description:
        "Discovery tier 1: list your capability servers (MCP namespaces) with how many functions each exposes. Then list_functions for one. Also available inside execute_js as servers().",
      inputSchema: z.object({}),
      async do(): Promise<ToolResultData> {
        return { status: "success", data: session.discoverServers() };
      },
    },
    {
      name: "list_functions",
      description:
        "Discovery tier 2: list one server's functions and their input signatures. Then describe_function for a full schema, or just call the function inside execute_js. Also available in the REPL as fns(\"server\").",
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
          return { status: "success", data: session.describeFunction(input.name) };
        } catch (err) {
          return errResult(err);
        }
      },
    },
  ];
}

export interface MountJsConfig extends JsToolOptions {
  session: JsSession;
  /** Prepend {@link JS_PREAMBLE} + the catalog hint. Default true. */
  prime?: boolean;
  /** How the catalog reaches the model. Default `progressive`. See {@link DiscoveryMode}. */
  discovery?: DiscoveryMode;
}

/** Fold `execute_js` + the discovery tools onto a built Glove and prime it. */
export function mountJs(glove: IGloveRunnable, config: MountJsConfig): IGloveRunnable {
  const { session, prime, discovery, ...toolOpts } = config;
  glove.fold(buildExecuteJsTool(session, toolOpts));
  for (const tool of buildDiscoveryTools(session)) glove.fold(tool as GloveFoldArgs<unknown>);
  if (prime !== false) {
    const mode = resolveMode(discovery, session);
    const existing = glove.getSystemPrompt();
    const preamble = buildJsPreamble(session, mode);
    glove.setSystemPrompt(existing ? `${preamble}\n\n${existing}` : preamble);
  }
  return glove;
}
