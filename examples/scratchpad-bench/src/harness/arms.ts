/**
 * The three arms under test, built over the SAME mock org and model:
 *
 *   - "baseline": every MCP tool from all ten servers folded directly into the
 *     agent (the realistic "I connected 10 MCP servers" setup). All ~32 tool
 *     schemas live in context; every result streams back verbatim.
 *   - "scratchpad": a single `execute_sql` tool (+ `explain_sql`) over the same
 *     capabilities exposed as SQL tables. The model discovers via
 *     information_schema and only the rows a SELECT returns enter context.
 *   - "lisp": a single `execute_lisp` tool (+ `explain_lisp`) over the same
 *     capabilities exposed as functions in a persistent Clojure-flavored REPL.
 *     Only the last form's (elided) value enters context; `def` keeps
 *     intermediates in the session; branching composes inside one program.
 */
import { Glove, Displaymanager, MemoryStore, type ModelAdapter } from "glove-core";
import { Database } from "glove-scratchpad";
import { bridgeMcpTool } from "glove-mcp";
import { mountDatabase } from "glove-scratchpad";
import { fnsFromMcp } from "glove-scratchpad/fns/mcp";
import { sampleResultShapes, fnSignature, type ToolFn } from "glove-scratchpad/fns";
import { LispSession, mountLisp } from "glove-lisp";
import { JsSession, mountJs } from "glove-js";
import { PySession, mountPy } from "glove-python";
import type { MockOrg } from "../mcp/index";
import { totalToolCount } from "../mcp/index";
import { BenchSubscriber } from "./instrument";

export type ArmName = "baseline" | "scratchpad" | "lisp" | "both" | "jsrepl" | "lispfns" | "pyrepl" | "polyglot";

export interface ArmConfig {
  maxTurns: number;
  compactionContextLimit: number;
  echo?: boolean;
  /** false = BARE mode: no primed preamble/catalog/discipline — the model gets
   *  only the role and the tools' own descriptions, and must DISCOVER the rest
   *  (information_schema / (tables) / (describe)). The realistic adopter setup. */
  prime?: boolean;
}

export interface BuiltArm {
  arm: ArmName;
  runnable: ReturnType<Glove["build"]>;
  sub: BenchSubscriber;
  toolsInContext: number;
  db?: Database;
  lisp?: LispSession;
  js?: JsSession;
  py?: PySession;
  /** For the polyglot arm — the three fn-mode sessions the model chooses between. */
  poly?: { py: PySession; js: JsSession; lisp: LispSession };
}

const COMPACTION_INSTRUCTIONS =
  "Summarize the conversation so far, preserving every concrete fact already retrieved " +
  "(ids, counts, names, states) and the user's outstanding request, so work can continue without re-fetching.";

const SHARED_ROLE =
  "You are an engineering-operations assistant for Acme. Answer the user's request precisely and concisely, " +
  "grounding every claim in data you actually retrieved. When the answer is a list or a count, state the exact " +
  "numbers/ids. Do not ask clarifying questions — make reasonable assumptions and finish the task.";

const SERVICE_LIST =
  "Connected services (as tools): GitHub, Linear, Email, Slack, Notion, Jira, Sentry, PagerDuty, Calendar, Filesystem. " +
  "Tool names are namespaced like `github__list_pull_requests`.";

function baseGlove(model: ModelAdapter, systemPrompt: string, cfg: ArmConfig): Glove {
  return new Glove({
    store: new MemoryStore(`bench_${Math.floor(Math.random() * 1e9)}`),
    model,
    displayManager: new Displaymanager(),
    systemPrompt,
    serverMode: true,
    maxRetries: 2,
    compaction_config: {
      max_turns: cfg.maxTurns,
      compaction_instructions: COMPACTION_INSTRUCTIONS,
      compaction_context_limit: cfg.compactionContextLimit,
    },
  });
}

export async function buildBaselineArm(model: ModelAdapter, org: MockOrg, cfg: ArmConfig): Promise<BuiltArm> {
  const glove = baseGlove(model, `${SHARED_ROLE}\n\n${SERVICE_LIST}`, cfg);
  const runnable = glove.build();

  // Fold every tool from every server directly — the "naive" surface.
  let folded = 0;
  for (const conn of org.connections) {
    const tools = await conn.listTools();
    for (const def of tools) {
      glove.fold(bridgeMcpTool(conn, def, true));
      folded++;
    }
  }

  const sub = new BenchSubscriber({ echo: cfg.echo });
  glove.addSubscriber(sub);
  return { arm: "baseline", runnable, sub, toolsInContext: folded };
}

export async function buildScratchpadArm(model: ModelAdapter, org: MockOrg, cfg: ArmConfig): Promise<BuiltArm> {
  const glove = baseGlove(model, SHARED_ROLE, cfg);
  const runnable = glove.build();

  const db = await Database.create({ policy: { writes: true } });
  db.registerAll(org.resources());
  // Folds execute_sql + explain_sql; primes unless bare mode.
  mountDatabase(runnable, { db, allowWrites: true, prime: cfg.prime !== false });

  const sub = new BenchSubscriber({ echo: cfg.echo });
  glove.addSubscriber(sub);
  // 2 tools in context (execute_sql, explain_sql) vs the baseline's ~32.
  return { arm: "scratchpad", runnable, sub, toolsInContext: 2, db };
}

export async function buildLispArm(model: ModelAdapter, org: MockOrg, cfg: ArmConfig): Promise<BuiltArm> {
  const glove = baseGlove(model, SHARED_ROLE, cfg);
  const runnable = glove.build();

  const lisp = LispSession.create({ policy: { writes: true } });
  lisp.registerAll(org.resources());
  // Folds execute_lisp + explain_lisp; primes unless bare mode.
  mountLisp(runnable, { session: lisp, allowWrites: true, prime: cfg.prime !== false });

  const sub = new BenchSubscriber({ echo: cfg.echo });
  glove.addSubscriber(sub);
  // 2 tools in context (execute_lisp, explain_lisp) vs the baseline's ~32.
  return { arm: "lisp", runnable, sub, toolsInContext: 2, lisp };
}

/**
 * The FUNCTION-MODE catalog: every tool of every server as a `ToolFn`, derived
 * from the SAME connections the resource arms use (via `fnsFromMcp`). No
 * columns, no pushdown keys, no volatility — the tool's own schema is the
 * contract. Effects hit the identical MCP handlers, so the A/B stays fair.
 */
async function catalogFromOrg(org: MockOrg): Promise<ToolFn[]> {
  const perServer = await Promise.all(org.connections.map((c) => fnsFromMcp(c)));
  const fns = perServer.flat();
  // Discovery parity with table mode: sample each read-only function once so the
  // primed catalog / describe carries the RESULT shape (field names + enums), not
  // just the input signature — the model needn't guess `.count` vs `.eventCount`.
  await sampleResultShapes(fns);
  return fns;
}

export async function buildJsArm(model: ModelAdapter, org: MockOrg, cfg: ArmConfig): Promise<BuiltArm> {
  const glove = baseGlove(model, SHARED_ROLE, cfg);
  const runnable = glove.build();

  // glove-js is fn-catalog only — a call fires immediately (no staging).
  const js = JsSession.create();
  js.registerAll(await catalogFromOrg(org));
  // Folds a single execute_js (no explain_js); primes unless bare mode.
  mountJs(runnable, { session: js, prime: cfg.prime !== false });

  const sub = new BenchSubscriber({ echo: cfg.echo });
  glove.addSubscriber(sub);
  // 1 tool in context (execute_js) vs the baseline's ~32.
  return { arm: "jsrepl", runnable, sub, toolsInContext: 1, js };
}

export async function buildPyArm(model: ModelAdapter, org: MockOrg, cfg: ArmConfig): Promise<BuiltArm> {
  const glove = baseGlove(model, SHARED_ROLE, cfg);
  const runnable = glove.build();

  // glove-python is fn-catalog only — a call fires immediately (no staging).
  // Same catalog as jsrepl/lispfns, driven with Python instead of JS/Clojure.
  const py = PySession.create();
  py.registerAll(await catalogFromOrg(org));
  // Folds a single execute_python; primes unless bare mode.
  mountPy(runnable, { session: py, prime: cfg.prime !== false });

  const sub = new BenchSubscriber({ echo: cfg.echo });
  glove.addSubscriber(sub);
  // 1 tool in context (execute_python) vs the baseline's ~32.
  return { arm: "pyrepl", runnable, sub, toolsInContext: 1, py };
}

export async function buildLispFnArm(model: ModelAdapter, org: MockOrg, cfg: ArmConfig): Promise<BuiltArm> {
  const glove = baseGlove(model, SHARED_ROLE, cfg);
  const runnable = glove.build();

  // The Lisp surface in FUNCTION MODE — the same catalog as jsrepl, driven with
  // Clojure instead of JS. `registerFns` (not `registerAll`) → LISP_FN_PREAMBLE.
  const lisp = LispSession.create({ policy: { writes: true } });
  lisp.registerFns(await catalogFromOrg(org));
  mountLisp(runnable, { session: lisp, allowWrites: true, prime: cfg.prime !== false });

  const sub = new BenchSubscriber({ echo: cfg.echo });
  glove.addSubscriber(sub);
  return { arm: "lispfns", runnable, sub, toolsInContext: 1, lisp };
}

/**
 * A neutral THREE-language preamble: the same function catalog is reachable
 * through execute_python, execute_js, and execute_lisp; the model picks the
 * language it's most fluent in. We measure the revealed preference (which
 * execute_* it calls) via toolMix — the REPL analogue of the SQL-vs-Lisp choice
 * study.
 */
const POLY_CARDS: Record<string, string> = {
  python: "- execute_python — Python: github.list_pull_requests(state=\"open\"); comprehensions, f-strings, sorted(key=…); bind with prs = …",
  js: "- execute_js — JavaScript: github.list_pull_requests({ state: \"open\" }); .filter/.map/.reduce; bind with const prs = …",
  lisp: "- execute_lisp — Clojure: (github_pull_requests {:state \"open\"}); filter/map/group-by/->>; bind with (def prs …)",
};

/** The language presentation order — counterbalanced via POLYGLOT_ORDER to
 *  separate a genuine preference from a first-listed ordering effect. */
function polyglotOrder(): Array<"python" | "js" | "lisp"> {
  const raw = (process.env.POLYGLOT_ORDER ?? "python,js,lisp").split(",").map((s) => s.trim());
  const valid = raw.filter((s): s is "python" | "js" | "lisp" => s === "python" || s === "js" || s === "lisp");
  return valid.length === 3 ? valid : ["python", "js", "lisp"];
}

function polyglotPreamble(fns: ToolFn[], order: Array<"python" | "js" | "lisp">): string {
  const catalog = fns.map((fn) => `- ${fnSignature(fn)}`).join("\n");
  const cards = order.map((k) => POLY_CARDS[k]).join("\n");
  return `Your capabilities are FUNCTIONS in a persistent, sandboxed REPL. You have THREE equivalent eval tools over the SAME functions — pick the language you are most fluent in and STAY in it for a task (each is fully capable; a result is authoritative from its own tool, do not re-verify across languages):

${cards}

The functions are NOT tools — they exist only INSIDE an eval program. Discover with fns() / describe("name") (python/js) or (tables) / (describe :name) (lisp). Call a function by name with its arguments; the result is plain data. COMPUTE in the program and let the LAST expression be your answer — the data flows between functions inside the program, it does not round-trip through you. Only the last value returns to your context, so return counts/small selections and bind the rest. BRANCH in one program with if/else. A call FIRES its effect immediately (no staging). If a call errors, change the one thing it names and retry — do not switch languages to escape an error.

The same functions, available in all three (signatures show INPUTS only; inspect a row for its fields):
${catalog}`;
}

export async function buildPolyglotArm(model: ModelAdapter, org: MockOrg, cfg: ArmConfig): Promise<BuiltArm> {
  const fns = await catalogFromOrg(org);
  const order = polyglotOrder();
  const glove = baseGlove(model, cfg.prime === false ? SHARED_ROLE : `${polyglotPreamble(fns, order)}\n\n${SHARED_ROLE}`, cfg);
  const runnable = glove.build();

  // Three fn-mode surfaces over the identical catalog; the model chooses.
  const py = PySession.create();
  py.registerAll(fns);
  const js = JsSession.create();
  js.registerAll(fns);
  const lisp = LispSession.create({ policy: { writes: true } });
  lisp.registerFns(fns);
  // Fold in the counterbalanced order too (tool-array order can bias choice).
  const mounters: Record<string, () => void> = {
    python: () => mountPy(runnable, { session: py, prime: false }),
    js: () => mountJs(runnable, { session: js, prime: false }),
    lisp: () => mountLisp(runnable, { session: lisp, allowWrites: true, prime: false }),
  };
  for (const k of order) mounters[k]();

  const sub = new BenchSubscriber({ echo: cfg.echo });
  glove.addSubscriber(sub);
  // 3 tools in context (execute_python/js/lisp) over one catalog.
  return { arm: "polyglot", runnable, sub, toolsInContext: 3, poly: { py, js, lisp } };
}

/** A neutral two-surface preamble: both cards, one catalog, free choice. */
function bothPreamble(org: MockOrg): string {
  const cat = org
    .resources()
    .map((t) => {
      const described = t.columns.filter((c) => c.description).map((c) => `${c.name} (${c.description})`);
      const detail = described.length ? `\n    columns — ${described.join("; ")}` : "";
      return `- ${t.name}: ${t.description ?? t.name}${detail}`;
    })
    .join("\n");
  return `Your capabilities are exposed through TWO equivalent surfaces over the SAME live services. Use whichever fits each task — both are fully capable; pick one per task and stay with it (a write made on one surface is confirmed by its own result; do not re-verify across surfaces).

SURFACE A — SQL database (tools: execute_sql, explain_sql).
Entities are tables (Postgres dialect). Push arguments as WHERE equalities; a vector of values fans out like IN. Compute in the query (COUNT/GROUP BY/JOIN/INSERT … SELECT). A single write fires immediately and reports its row count; BEGIN … COMMIT stages several writes. Discovery: information_schema.tables / .columns (is_nullable marks required keys; description carries valid values).

SURFACE B — Lisp REPL (tools: execute_lisp, explain_lisp), Clojure-flavored, PERSISTENT ((def name …) survives across calls).
Entities are functions: (github_pull_requests {:state "open"}) — the argument map pushes down; vector values fan out like IN. Compute in the program (count/filter/group-by/frequencies/max-key; (sort-by :k > rows) sorts descending; (apply max-key :k rows) is argmax). BRANCHING composes in one call: (if (empty? xs) (insert! :slack_messages {…}) (insert! :emails {…})). Writes: (insert! :t {…}) fires immediately with a row count; (insert! :t (map f rows)) bulk-writes in ONE call; (stage …) then (commit!)/(rollback!) stages several. Discovery: (tables), (describe :name).

Shared rules: only the data your query/program RETURNS enters your context — return counts and small selections, never raw dumps. Writes are immediate and authoritative; do NOT verify them with reads (your own writes are reflected if you do). Be decisive: prefer ONE composed call; if a call errors, change the one thing the message names.

Entities available on BOTH surfaces (use exact values as shown):
${cat}`;
}

export async function buildBothArm(model: ModelAdapter, org: MockOrg, cfg: ArmConfig): Promise<BuiltArm> {
  const glove = baseGlove(model, cfg.prime === false ? SHARED_ROLE : `${bothPreamble(org)}\n\n${SHARED_ROLE}`, cfg);
  const runnable = glove.build();

  const db = await Database.create({ policy: { writes: true } });
  db.registerAll(org.resources());
  mountDatabase(runnable, { db, allowWrites: true, prime: false });

  const lisp = LispSession.create({ policy: { writes: true } });
  lisp.registerAll(org.resources());
  mountLisp(runnable, { session: lisp, allowWrites: true, prime: false });

  const sub = new BenchSubscriber({ echo: cfg.echo });
  glove.addSubscriber(sub);
  // 4 tools in context: execute_sql, explain_sql, execute_lisp, explain_lisp.
  return { arm: "both", runnable, sub, toolsInContext: 4, db, lisp };
}

export function baselineToolTotal(org: MockOrg): number {
  return totalToolCount(org.specs);
}
