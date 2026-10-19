/**
 * The model-facing surface. Three ways in, over one `AppHost`:
 *
 * - **Tools** (`mountMiniApps`): seven `glove_miniapps_*` tools to build, use
 *   and share apps, plus — optionally — one tool per method of every app the
 *   agent can reach, kept in sync as apps are deployed.
 * - **Runtime context**: before each model turn the agent is told which apps
 *   it has. That is what "agents always reference their own apps" rests on:
 *   the list is read live, not written into a prompt once.
 * - **Functions** (`miniAppFns`): the same operations as `ToolFn`s, for a
 *   working environment (`defineTools({ name: "apps", fns })` → `env:apps`) or
 *   a glove-js REPL, so a script can read an app's rows into a variable
 *   instead of the context window.
 *
 * Every type here is structural, so this package does not depend on
 * glove-core or glove-working-environment.
 */

import { isMiniAppError } from "./errors";
import { EXAMPLE_APP } from "./example";
import type { AppHost } from "./host";
import type { AppDefinition, AppSummary, Grant, Migration, ParamDef, Principal } from "./types";

export interface MiniAppToolResult {
  status: "success" | "error";
  data: unknown;
  message?: string;
}

/** Structurally a glove-core `GloveFoldArgs` with a raw JSON Schema. */
export interface MiniAppTool {
  name: string;
  description: string;
  jsonSchema: Record<string, unknown>;
  do(input: any, display?: unknown, agent?: unknown, signal?: AbortSignal): Promise<MiniAppToolResult>;
}

/** Any Glove runnable or builder. */
export interface MiniAppsMountable {
  fold(tool: MiniAppTool): unknown;
  replaceTools?(previous: Iterable<string>, next: ReadonlyArray<MiniAppTool>): unknown;
  addContextProvider?(provider: () => string | null | Promise<string | null>): () => void;
}

/** Structurally glove-scratchpad's `ToolFn`. */
export interface MiniAppFn {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  readOnlyHint?: boolean;
  call(args: Record<string, unknown>, ctx?: { signal?: AbortSignal }): Promise<unknown>;
}

export interface MiniAppToolsOptions {
  host: AppHost;
  /** Who the agent is to the host. Use something stable across conversations — the agent instance — so its apps follow it. */
  as: Principal;
  /** Tool name prefix. Default `glove_miniapps`. */
  prefix?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// The guide the deploy tool carries
// ─────────────────────────────────────────────────────────────────────────────

export const MINIAPPS_GUIDE = `A mini app is a small durable app you keep for yourself: tables, methods over them, and optional scheduled outputs. It outlives this conversation; you and anyone you share it with can call it later.

A complete definition:
${JSON.stringify(EXAMPLE_APP)}

Rules:
- Column types: text, integer, real, boolean, json, timestamp. Columns are required unless "nullable": true or given a "default". An integer primaryKey is assigned on insert.
- A "query" only reads. An "action" runs in one transaction: if it throws or breaks a constraint, nothing it did is kept.
- sql: one statement, or a list run in order; the result is the last one's rows ("returns": "one" for the first row). Parameters are :name; :caller and :now are always available. Use portable SQL (no now(), no dialect-only functions).
- js: a small JavaScript subset. args and ctx (app, caller, now) are in scope; db.query({ sql, params }), db.one(...), app.emit({ event, data }) in actions, apps.query({ app, method, args }) to call another app's query methods. The last expression is the result. Use ctx.now, not Date.now().
- Outputs run on a cadence ("every": "30m" | "6h" | "1d" | "7d"); a string result is shown as markdown.
- Changing an app: deploy the whole new definition again. Added tables, nullable/defaulted columns and indexes migrate themselves. A rename or a drop needs "migration": { "ops": [...] } — rename_table, rename_column, drop_table, drop_column, add_column, add_index, drop_index, create_table, or { "op": "sql", "sql": "UPDATE …" } to fill data. Use dry_run first when you are unsure.`;

// ─────────────────────────────────────────────────────────────────────────────
// Tools
// ─────────────────────────────────────────────────────────────────────────────

const ok = (data: unknown, message?: string): MiniAppToolResult => ({ status: "success", data, ...(message ? { message } : {}) });

function fail(err: unknown): MiniAppToolResult {
  if (isMiniAppError(err)) {
    const details = err.details?.length ? `\n- ${err.details.join("\n- ")}` : "";
    return { status: "error", data: err.toJSON(), message: `${err.message}${details}` };
  }
  return { status: "error", data: null, message: (err as Error)?.message ?? String(err) };
}

const guard = (fn: (input: any, signal?: AbortSignal) => Promise<MiniAppToolResult>) =>
  async (input: any, _display?: unknown, _agent?: unknown, signal?: AbortSignal) => {
    try {
      return await fn(input ?? {}, signal);
    } catch (err) {
      return fail(err);
    }
  };

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

export function miniAppTools(options: MiniAppToolsOptions & { onDeploy?: () => void | Promise<void> }): MiniAppTool[] {
  const { host, as } = options;
  const p = options.prefix ?? "glove_miniapps";
  return [
    {
      name: `${p}_list`,
      description: "List your mini apps and the ones others shared with you, with their methods and outputs.",
      jsonSchema: obj({}),
      do: guard(async (_i, signal) => ok(await host.list({ as, signal }))),
    },
    {
      name: `${p}_describe`,
      description: "One app's tables, methods with their parameters, outputs and subscriptions. For your own app it includes the full definition, to edit and deploy again.",
      jsonSchema: obj({ app: { type: "string" } }, ["app"]),
      do: guard(async (i, signal) => ok(await host.describe(i.app, { as, signal }))),
    },
    {
      name: `${p}_deploy`,
      description: `Create a mini app, or upgrade one of yours by deploying its whole new definition.\n\n${MINIAPPS_GUIDE}`,
      jsonSchema: obj(
        {
          definition: { type: "object", description: "The complete app definition." },
          migration: { type: "object", description: 'Only for renames and drops: { "ops": [...] }.' },
          dry_run: { type: "boolean", description: "Run the migration and roll it back, to see what would happen." },
        },
        ["definition"],
      ),
      do: guard(async (i, signal) => {
        const r = await host.deploy(i.definition as AppDefinition, {
          as,
          signal,
          migration: i.migration as Migration | undefined,
          dryRun: i.dry_run === true,
        });
        if (!r.dryRun) await options.onDeploy?.();
        const verb = r.dryRun ? "would deploy" : r.created ? "created" : "upgraded";
        return ok(r, `${verb} ${r.app} v${r.version} (${r.migration.length} migration op${r.migration.length === 1 ? "" : "s"})${r.warnings.length ? `; warnings: ${r.warnings.join("; ")}` : ""}`);
      }),
    },
    {
      name: `${p}_call`,
      description: "Call a method of a mini app. Queries read; actions change the app and either fully happen or not at all.",
      jsonSchema: obj({ app: { type: "string" }, method: { type: "string" }, args: { type: "object" } }, ["app", "method"]),
      do: guard(async (i, signal) => {
        const r = await host.call(i.app, i.method, i.args ?? {}, { as, signal });
        return ok(r.events.length || r.deliveries?.length ? r : r.value);
      }),
    },
    {
      name: `${p}_output`,
      description: "Run one of an app's outputs now and return what it produces.",
      jsonSchema: obj({ app: { type: "string" }, output: { type: "string" } }, ["app", "output"]),
      do: guard(async (i, signal) => ok(await host.output(i.app, i.output, { as, signal }))),
    },
    {
      name: `${p}_events`,
      description: "Read an app's event log (what its actions recorded), oldest first. Pass after (a seq) to read only newer events.",
      jsonSchema: obj({ app: { type: "string" }, after: { type: "integer" }, limit: { type: "integer" } }, ["app"]),
      do: guard(async (i, signal) => ok(await host.events(i.app, { as, signal, after: i.after, limit: i.limit }))),
    },
    {
      name: `${p}_share`,
      description:
        'Share one of your apps: let another agent or person call some or all of its methods, and optionally read its events. methods: a list of names or "*". An empty list with events false removes their access.',
      jsonSchema: obj(
        {
          app: { type: "string" },
          to: { type: "string", description: "Their principal, e.g. agent:reviewer." },
          methods: { anyOf: [{ type: "array", items: { type: "string" } }, { const: "*" }] },
          events: { type: "boolean" },
        },
        ["app", "to", "methods"],
      ),
      do: guard(async (i, signal) => {
        const grant = { to: i.to, methods: i.methods, events: i.events === true } as Grant;
        const revoke = Array.isArray(grant.methods) && grant.methods.length === 0 && !grant.events;
        return ok(revoke ? await host.revoke(i.app, i.to, { as, signal }) : await host.grant(i.app, grant, { as, signal }));
      }),
    },
  ];
}

/**
 * One tool per callable method: `app_<app>__<method>`, with the method's
 * parameters as its schema. Worth it for a handful of apps the agent uses
 * every turn; past that the catalogue costs more context than it saves.
 */
export async function methodTools(options: MiniAppToolsOptions & { apps?: string[] }): Promise<MiniAppTool[]> {
  const { host, as } = options;
  const tools: MiniAppTool[] = [];
  for (const app of await host.list({ as })) {
    if (options.apps && !options.apps.includes(app.name)) continue;
    const d = await host.describe(app.name, { as });
    for (const m of d.methods) {
      tools.push({
        name: `app_${app.name}__${m.name}`,
        description: `${m.kind === "query" ? "[reads]" : "[changes]"} ${app.name}: ${m.description}`,
        jsonSchema: paramsSchema(m.params),
        do: guard(async (i, signal) => ok((await host.call(app.name, m.name, i, { as, signal })).value)),
      });
    }
  }
  return tools;
}

export function paramsSchema(params: Record<string, ParamDef>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [name, p] of Object.entries(params)) {
    properties[name] = {
      ...(p.type === "any" ? {} : { type: p.type }),
      ...(p.description ? { description: p.description } : {}),
      ...(p.enum ? { enum: p.enum } : {}),
    };
    if (!p.optional) required.push(name);
  }
  return { type: "object", properties, required, additionalProperties: false };
}

/** The runtime-context line: the agent's apps, read fresh before each turn. */
export function describeApps(apps: AppSummary[], prefix = "glove_miniapps"): string | null {
  if (apps.length === 0) {
    return `You have no mini apps yet. When you find yourself tracking the same kind of thing across conversations — a list, a ledger, a log, a recurring report — build one with ${prefix}_deploy instead of keeping it in your head.`;
  }
  const lines = apps.map((a) => {
    const methods = a.methods.map((m) => `${m.name}${m.kind === "action" ? "!" : ""}`).join(", ");
    const outputs = a.outputs.length ? `; outputs: ${a.outputs.join(", ")}` : "";
    const whose = a.access === "owner" ? "" : ` (shared by ${a.owner})`;
    return `- ${a.name} v${a.version}${whose} — ${a.description}. Methods: ${methods}${outputs}`;
  });
  return `Your mini apps (call with ${prefix}_call; ! marks actions):\n${lines.join("\n")}`;
}

export interface MountMiniAppsOptions extends MiniAppToolsOptions {
  /** Fold one tool per method (all apps, or the named ones). Default false. */
  exposeMethods?: boolean | string[];
  /** Tell the agent its apps before each turn. Default true. */
  context?: boolean;
}

export interface MountedMiniApps {
  tools: MiniAppTool[];
  /** Re-read the apps and replace the per-method tools. Called after each deploy. */
  refresh(): Promise<void>;
  /** Remove the context provider. */
  close(): void;
}

/** Fold the mini-app tools onto a Glove agent and keep it told about its apps. */
export async function mountMiniApps(agent: MiniAppsMountable, options: MountMiniAppsOptions): Promise<MountedMiniApps> {
  const prefix = options.prefix ?? "glove_miniapps";
  let methodNames: string[] = [];
  const refresh = async () => {
    if (!options.exposeMethods) return;
    const next = await methodTools({ ...options, apps: Array.isArray(options.exposeMethods) ? options.exposeMethods : undefined });
    if (agent.replaceTools) agent.replaceTools(methodNames, next);
    else for (const t of next.filter((t) => !methodNames.includes(t.name))) agent.fold(t);
    methodNames = next.map((t) => t.name);
  };
  const tools = miniAppTools({ ...options, onDeploy: refresh });
  for (const t of tools) agent.fold(t);
  await refresh();
  const unregister =
    options.context !== false && agent.addContextProvider
      ? agent.addContextProvider(async () => describeApps(await options.host.list({ as: options.as }), prefix))
      : () => {};
  return { tools, refresh, close: unregister };
}

// ─────────────────────────────────────────────────────────────────────────────
// Functions, for working environments and REPLs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The host as functions: `list`, `describe`, `invoke`, `output`, `events`.
 * Deploying stays a tool — a script that redefines the app it is running
 * against is a loop nobody wants to debug.
 *
 * ```ts
 * defineTools({ name: "apps", fns: miniAppFns({ host, as }) })
 * // a script: import { invoke } from "env:apps";
 * //           const open = await invoke({ app: "tasks", method: "open" });
 * ```
 */
export function miniAppFns(options: MiniAppToolsOptions): MiniAppFn[] {
  const { host, as } = options;
  return [
    {
      name: "list",
      description: "Your mini apps and the ones shared with you.",
      inputSchema: obj({}),
      readOnlyHint: true,
      call: async (_a, ctx) => host.list({ as, signal: ctx?.signal }),
    },
    {
      name: "describe",
      description: "An app's tables, methods and outputs.",
      inputSchema: obj({ app: { type: "string" } }, ["app"]),
      readOnlyHint: true,
      call: async (a, ctx) => host.describe(String(a.app), { as, signal: ctx?.signal }),
    },
    {
      // Not `call`: glove-js refuses a member named call/apply/bind, and these
      // functions mount unchanged in a REPL as well as in a working environment.
      name: "invoke",
      description: "Call a method; returns its value.",
      inputSchema: obj({ app: { type: "string" }, method: { type: "string" }, args: { type: "object" } }, ["app", "method"]),
      readOnlyHint: false,
      call: async (a, ctx) =>
        (await host.call(String(a.app), String(a.method), (a.args as Record<string, unknown>) ?? {}, { as, signal: ctx?.signal })).value,
    },
    {
      name: "output",
      description: "Run an output now; returns its value.",
      inputSchema: obj({ app: { type: "string" }, output: { type: "string" } }, ["app", "output"]),
      readOnlyHint: true,
      call: async (a, ctx) => (await host.output(String(a.app), String(a.output), { as, signal: ctx?.signal })).value,
    },
    {
      name: "events",
      description: "An app's event log after a seq.",
      inputSchema: obj({ app: { type: "string" }, after: { type: "integer" }, limit: { type: "integer" } }, ["app"]),
      readOnlyHint: true,
      call: async (a, ctx) =>
        host.events(String(a.app), { as, signal: ctx?.signal, after: a.after as number | undefined, limit: a.limit as number | undefined }),
    },
  ];
}
