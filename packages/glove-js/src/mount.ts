/**
 * Mount the JS surface onto a Glove agent: fold the eval tool and prime the
 * model to discover → read → compute → act.
 *
 * The surface ships THREE interchangeable framings of the same eval tool, chosen
 * at mount time with `frame`:
 *   - `"repl"` (default) — the classic persistent REPL. Tool name `execute_js`.
 *   - `"program"` — a complete-program framing. Tool name `execute_js_program`.
 *   - `"workflow"` — a one-shot-workflow framing that actively de-REPLs the
 *     priming (author the WHOLE task as one program; only the final value
 *     returns; cross-call state is a retry fallback, not a working style). Tool
 *     name `execute_js_workflow`.
 *
 * The runtime is identical across framings — same session, same persistence, same
 * effects. Only the tool NAME and the priming change. The bet (see the bench's
 * FRAME-PAPER) is that the name and framing steer whether a model composes
 * one program or degrades the surface into an incremental tool-call loop.
 */
import { z } from "zod";
import { fnSignature } from "glove-scratchpad/fns";
import type { GloveFoldArgs, IGloveRunnable } from "glove-core/glove";
import type { ToolResultData } from "glove-core/core";
import type { JsSession } from "./session";

/** Which framing of the eval tool to mount. See the module doc. */
export type Frame = "repl" | "program" | "workflow";

const JS_TOOL_NAMES: Record<Frame, string> = {
  repl: "execute_js",
  program: "execute_js_program",
  workflow: "execute_js_workflow",
};

/** The eval tool's name for a framing (`execute_js` / `_program` / `_workflow`). */
export function jsToolName(frame: Frame = "repl"): string {
  return JS_TOOL_NAMES[frame];
}

export interface JsToolOptions {
  /** Stamped into the tool-call context as the actor. */
  actor?: string;
  /** Which framing to mount. Default `"repl"`. */
  frame?: Frame;
}

/** The head paragraph — the mental model the framing hands the model. */
function head(frame: Frame, tool: string): string {
  if (frame === "workflow") {
    return `You accomplish tasks by authoring WORKFLOWS. You have EXACTLY ONE tool: ${tool}. A workflow is ONE complete JavaScript program (the "code" string) that carries a task from start to finish — discover, read, filter, compute, branch, and act — in a SINGLE call. This is NOT an interactive prompt: do not run one line and wait to see the result, then run another. Write the WHOLE task as one program and let only the final value return. Think "write the script", not "type at a REPL".`;
  }
  if (frame === "program") {
    return `You accomplish tasks by writing COMPLETE JavaScript programs. You have EXACTLY ONE tool: ${tool}. Each call runs one self-contained program (the "code" string) and returns the value of its last expression. Compose a whole step — discover, read, compute, and act — as ONE program rather than a line at a time.`;
  }
  return `Your capabilities are functions inside a persistent JavaScript REPL. You have EXACTLY ONE tool: ${tool}. Everything you do is a JavaScript program you pass to ${tool} as a "code" string. The REPL is PERSISTENT: any top-level const/let you declare stays available in later calls.`;
}

/** How cross-call persistence is presented — the substrate is identical, but the
 *  framing decides whether it reads as "split freely" or "one-shot, retry only". */
function persistence(frame: Frame): string {
  if (frame === "workflow") {
    return `\n\nBindings from an earlier call DO survive into later ones — but treat that only as a RECOVERY aid: if a workflow fails partway (e.g. an effect already fired), you can continue from where it stopped without recomputing the expensive prefix. Never split a task across calls on purpose — collapsing it into one workflow is exactly what this surface is for.`;
  }
  if (frame === "program") {
    return `\n\nTop-level const/let persist across calls if you need them, but prefer to finish a task in one program.`;
  }
  return "";
}

/** The shape bullet. In the REPL framing the cheap move is a separate peek call;
 *  the one-shot framings point out you can bind-and-read a row in the SAME
 *  program, so no split is needed to learn a shape. */
function shapeBullet(frame: Frame): string {
  if (frame === "repl") {
    return `- KNOW THE SHAPE BEFORE YOU USE IT. You do NOT know a result's field names or a field's allowed values in advance — the catalog shows a function's INPUTS, not the shape of its rows. Before you filter, sort, argmax, or read a property, inspect one row FIRST: return \`rows[0]\` or \`Object.keys(rows[0])\` from an initial call (or bind \`const rows = fn(...)\` and read \`rows[0]\`), then use the EXACT field names and values you saw. Guessing a field (e.g. \`.eventCount\` when the real field is \`.count\`) returns \`undefined\` and a silently WRONG answer — an argmax over undefined just returns the first row. Likewise for filters: push the constraint into the arguments (\`{ status: "unresolved" }\` — see describe) rather than fetching everything and filtering by a guessed enum value; if unsure what values a field takes, inspect the rows.`;
  }
  return `- KNOW THE SHAPE — WITHOUT A SEPARATE CALL. You do NOT know a result's field names in advance, but you do NOT need to round-trip to learn them: describe("name") shows the row shape, and INSIDE one program you can \`const rows = fn(...)\` and immediately read \`rows[0]\` / compute over it in the same program. Use the EXACT field names you see there — guessing a field (e.g. \`.eventCount\` when the real field is \`.count\`) returns \`undefined\` and a silently WRONG answer. Push filters into the arguments (\`{ status: "unresolved" }\` — see describe) rather than fetching everything and filtering by a guessed enum value.`;
}

/** The decisiveness bullet — the one-shot framings name "one workflow/program"
 *  as the explicit target rather than "as few calls as possible". */
function decisiveBullet(frame: Frame): string {
  if (frame === "workflow") {
    return `- BE DECISIVE — the target is ONE workflow per task. A single program that reads, computes, branches, and acts beats a handful of small calls. If a workflow errors, read the message, change the ONE thing it names, and re-author the remaining steps — do not re-run an unchanged program or thrash.`;
  }
  if (frame === "program") {
    return `- BE DECISIVE — aim for ONE program per task. A program that reads, computes, and acts beats many small ones. If a call errors, read the message, change the ONE thing it names, and retry — do not re-run the same program or thrash.`;
  }
  return `- BE DECISIVE — answer in as FEW calls as possible. If a call errors, read the message, change the ONE thing it names, and retry — do not re-run the same program or thrash.`;
}

const JS_LANG_CARD = `Language card (this is the WHOLE language — nothing else exists):
- const/let, arrow functions and function declarations, template literals, destructuring (with defaults and ...rest), spread, optional chaining (?.), for…of / for / while (a fuel budget caps runaway loops), if/else, switch, try/catch, throw.
- Data: numbers, "strings", \`templates\`, [arrays], {objects}, null, true/false. Array methods (map/filter/reduce/find/some/every/sort/slice/flat/flatMap/includes/join/…), string methods, Object.keys/values/entries/assign/fromEntries, Math, JSON, new Set/Map/Date/RegExp, console.log (captured).
- NO class, import/require, eval, Function, this, prototypes, fetch, for…in, var. Member escapes (constructor, __proto__) are blocked.
- Tool calls: github.list_pull_requests({ state: "open" }) — results are plain data; promises resolve automatically, so \`await\` is optional.`;

/** Build the language-card + operating-discipline preamble body for a framing.
 *  (The catalog hint is appended separately by {@link buildJsPreamble}.) */
export function buildJsPreambleBody(frame: Frame = "repl"): string {
  const tool = jsToolName(frame);
  const unit = frame === "workflow" ? "workflow" : "program";
  return `${head(frame, tool)}${persistence(frame)}

READ THIS FIRST — the functions listed below are NOT tools. They cannot be called directly; they exist ONLY inside a ${tool} ${unit}. There is no \`github__list_pull_requests\` tool, no \`sentry__list_issues\` tool — the ONLY tool is ${tool}. To use a capability you MUST wrap it:
  ✗ WRONG: call the tool github__list_pull_requests  → it does not exist, nothing happens
  ✓ RIGHT: ${tool}({ code: 'github.list_pull_requests({ state: "open" }).length' })
If you ever find yourself with no data, it is almost always because you tried to call a capability as a tool instead of inside ${tool}. Always call ${tool}.

${JS_LANG_CARD}

Operating discipline:
- DISCOVER before you act: fns() lists your functions; describe("name") shows one function's parameters (required ones are marked). The catalog below is already current — spend discovery calls only when unsure.
- CALL a function by name, passing its arguments as ONE object: github.list_pull_requests({ state: "open" }) (or the flat form github__list_pull_requests({ state: "open" })). The result is whatever the tool returns — usually an array of objects, or a value.
${shapeBullet(frame)}
- COMPUTE in the ${unit}, not in your head. Counting, grouping, joining, argmax — write the expression and let the LAST expression be your answer: github.list_pull_requests({ state: "open" }).length. Data flows between functions inside the ${unit} — it does NOT round-trip through you.
- RETURN WHAT YOU MUST REPORT. If the answer needs ids or names, return them (a count plus a small .map(x => x.id) list) — never state values you did not read.
- KEEP BIG DATA OUT OF YOUR CONTEXT. const prs = github.list_pull_requests() stores the rows in the ${unit} and echoes only a summary; then prs.length, prs.slice(0, 5), prs.map(p => p.title). Never end a ${unit} with a huge array you don't need.
- BRANCH in one ${unit} with if/else — decide-and-act is ONE call, not a read, a look, and a second call.
${decisiveBullet(frame)}
- CALLS FIRE IMMEDIATELY. Calling an effectful function performs the effect and returns its result — there is NO staging, undo, or dry run. Check parameters with describe("name") BEFORE an effectful call. If a ${unit} errors AFTER an effectful call already fired, do NOT re-run the whole ${unit} (it would repeat the effect) — fix and continue from where it failed.

The only data that enters your context is the value of the LAST expression — so return counts, small selections, or summaries, and bind the rest to a const.`;
}

/**
 * The classic REPL preamble, kept as an exported constant for backward
 * compatibility. Equivalent to `buildJsPreambleBody("repl")`.
 */
export const JS_PREAMBLE = buildJsPreambleBody("repl");

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
function catalogHint(session: JsSession, mode: "progressive" | "full", tool: string): string {
  const fns = session.list();
  if (fns.length === 0) return "";
  if (mode === "full") {
    const lines = fns.map((fn) => `- ${fnSignature(fn)}`);
    return `\n\nFunctions you can call INSIDE ${tool} (these are not tools — signatures show INPUTS only; inspect a row for its fields):\n${lines.join("\n")}`;
  }
  const servers = session.discoverServers();
  return `\n\nDISCOVER YOUR CAPABILITIES — they are NOT listed here. You have ${fns.length} functions across ${servers.length} servers; find the few you need:
- FASTEST: search_functions({ query: "open pull requests" }) — jump straight to the matching functions when you know what you want.
- Or browse: list_servers() → list_functions({ server: "github" }) → describe_function({ name: "github__list_pull_requests" }) for parameters + result shape.
Each is available BOTH as a tool AND inside ${tool} (as search("…") / servers() / fns("github") / describe("name")). A capable model can script the sweep in one program — e.g. search("send email") — or fire the discovery tools in a batch first, then write one program. describe() a function before filtering on a field (it shows the row shape). Call a function by its name once you know it.`;
}

/** Build the preamble (language card + operating discipline + catalog hint). */
export function buildJsPreamble(
  session: JsSession,
  mode: "progressive" | "full" = "progressive",
  frame: Frame = "repl",
): string {
  return buildJsPreambleBody(frame) + catalogHint(session, mode, jsToolName(frame));
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

/** The eval tool's description, tuned to the framing (one-shot emphasis). */
function toolDescription(frame: Frame): string {
  const unit = frame === "workflow" ? "workflow" : "program";
  const lead =
    frame === "workflow"
      ? `The ONLY tool: author a WORKFLOW — one complete JavaScript program (the \`code\` string) that carries the whole task from discovery to answer in a single call, run against your persistent capability session. `
      : frame === "program"
        ? `The ONLY tool: run a complete JavaScript program (the \`code\` string) against your capability session (persistent). `
        : `The ONLY tool: run a JavaScript program (the \`code\` string) against your capability REPL (persistent). `;
  return (
    lead +
    `Your capabilities are FUNCTIONS you call INSIDE this ${unit} — they are NOT tools you can call directly. ` +
    'DISCOVER: search_functions({ query }) jumps to matching functions, or browse list_servers → list_functions({ server }) → describe_function({ name }) (as tools), or search()/servers()/fns("server")/describe("name") inside the code. ' +
    "CALL a capability by name inside the code — github.list_pull_requests({ state: \"open\" }) — arguments go in ONE object; promises resolve automatically. " +
    "INSPECT a row (Object.keys(rows[0])) before filtering/sorting on a field — the signatures show inputs, not result fields; never guess a field name. " +
    `COMPUTE in the ${unit} (.length / .filter / .reduce / group with a Map) and let the LAST expression be the answer; ` +
    `top-level const keeps big intermediates across calls. ` +
    `BRANCH inside one ${unit} with if/else — decide-and-act is one call. Calling an effectful function FIRES it immediately (no staging).`
  );
}

export function buildExecuteJsTool(session: JsSession, opts: JsToolOptions = {}): GloveFoldArgs<{ code: string }> {
  const frame = opts.frame ?? "repl";
  const tool = jsToolName(frame);
  return {
    name: tool,
    description: toolDescription(frame),
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
 *  (`search()` / `servers()` / `fns(server)` / `describe(name)`). */
export function buildDiscoveryTools(
  session: JsSession,
): [GloveFoldArgs<{ query: string }>, GloveFoldArgs<Record<string, never>>, GloveFoldArgs<{ server: string }>, GloveFoldArgs<{ name: string }>] {
  return [
    {
      name: "search_functions",
      description:
        "Discovery: jump straight to the functions matching a free-text query (e.g. \"open pull requests\") — the fast path when you know what you want but not which server. Also available in the eval program as search(\"query\").",
      inputSchema: z.object({ query: z.string().describe('What you want to do, e.g. "send email" or "list open PRs".') }),
      async do(input: { query: string }): Promise<ToolResultData> {
        return { status: "success", data: session.searchFunctions(input.query) };
      },
    },
    {
      name: "list_servers",
      description:
        "Discovery tier 1: list your capability servers (MCP namespaces) with how many functions each exposes. Then list_functions for one. Also available inside the eval program as servers().",
      inputSchema: z.object({}),
      async do(): Promise<ToolResultData> {
        return { status: "success", data: session.discoverServers() };
      },
    },
    {
      name: "list_functions",
      description:
        "Discovery tier 2: list one server's functions and their input signatures. Then describe_function for a full schema, or just call the function inside the eval program. Also available in the eval program as fns(\"server\").",
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
        "Discovery tier 3: the full parameters + result shape of one function. Also available in the eval program as describe(\"name\").",
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

export interface MountJsConfig extends JsToolOptions {
  session: JsSession;
  /** Prepend the preamble + the catalog hint. Default true. */
  prime?: boolean;
  /** How the catalog reaches the model. Default `progressive`. See {@link DiscoveryMode}. */
  discovery?: DiscoveryMode;
}

/** Fold the eval tool + the discovery tools onto a built Glove and prime it. */
export function mountJs(glove: IGloveRunnable, config: MountJsConfig): IGloveRunnable {
  const { session, prime, discovery, ...toolOpts } = config;
  const frame = toolOpts.frame ?? "repl";
  glove.fold(buildExecuteJsTool(session, toolOpts));
  for (const tool of buildDiscoveryTools(session)) glove.fold(tool as GloveFoldArgs<unknown>);
  if (prime !== false) {
    const mode = resolveMode(discovery, session);
    const existing = glove.getSystemPrompt();
    const preamble = buildJsPreamble(session, mode, frame);
    glove.setSystemPrompt(existing ? `${preamble}\n\n${existing}` : preamble);
  }
  return glove;
}
