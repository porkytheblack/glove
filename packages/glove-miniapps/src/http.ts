/**
 * The host over HTTP, both ends. `serveMiniApps` turns an `AppHost` into a
 * fetch-style handler (`Request → Response`), which is what a platform such as
 * Kuiper runs; `remoteAppHost` is an `AppHost` that calls one. Code written
 * against the interface — the tools, the Foundry layer — cannot tell a remote
 * host from a local one.
 *
 *   GET    /v1/apps                              list
 *   GET    /v1/apps/:app                         describe
 *   PUT    /v1/apps/:app                         deploy   { definition, migration?, dryRun? }
 *   DELETE /v1/apps/:app                         remove
 *   POST   /v1/apps/:app/methods/:method         call     { args? }
 *   GET    /v1/apps/:app/events?after=&limit=    events
 *   POST   /v1/apps/:app/outputs/:output         output
 *   PUT    /v1/apps/:app/grants/:principal       grant    { methods, events? }
 *   DELETE /v1/apps/:app/grants/:principal       revoke
 *   POST   /v1/tick                              tick     (trusted callers only)
 *
 * Errors are `{ error, code, details? }` with the status from `HTTP_STATUS`.
 */

import { HTTP_STATUS, MiniAppError, type MiniAppErrorCode } from "./errors";
import type { AppHost, Caller, DeployOptions } from "./host";
import type { AppDefinition, AppDescription, AppEvent, AppSummary, CallResult, DeployResult, Grant, OutputResult, Principal } from "./types";

/** Who a request is from. `actAs` lets it name a principal in `x-miniapps-as` — for a trusted server acting for its agents. */
export interface Authenticated {
  principal: Principal;
  actAs?: boolean | ((principal: Principal) => boolean);
}

export interface ServeOptions {
  /** Return null to refuse the request with a 401. */
  authenticate: (req: Request) => Authenticated | null | Promise<Authenticated | null>;
  /** Path prefix. Default `/v1`. */
  base?: string;
}

const AS_HEADER = "x-miniapps-as";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function serveMiniApps(host: AppHost, options: ServeOptions): (req: Request) => Promise<Response> {
  const base = (options.base ?? "/v1").replace(/\/$/, "");
  return async (req) => {
    try {
      const auth = await options.authenticate(req);
      if (!auth) return json(401, { error: "a valid key is required", code: "unauthorized" });
      const claimed = req.headers.get(AS_HEADER);
      let as = auth.principal;
      if (claimed && claimed !== as) {
        const allowed = typeof auth.actAs === "function" ? auth.actAs(claimed) : auth.actAs === true;
        if (!allowed) return json(403, { error: `this key cannot act as ${claimed}`, code: "forbidden" });
        as = claimed;
      }
      const caller: Caller = { as, signal: req.signal };

      const url = new URL(req.url);
      if (!url.pathname.startsWith(`${base}/`)) return json(404, { error: "not found", code: "not_found" });
      const parts = url.pathname.slice(base.length + 1).split("/").filter(Boolean).map(decodeURIComponent);
      const body = async () => (req.method === "GET" || req.method === "DELETE" ? {} : ((await req.json().catch(() => ({}))) ?? {}));
      const [root, app, sub, name] = parts;

      if (root === "tick" && parts.length === 1 && req.method === "POST") {
        if (!auth.actAs) return json(403, { error: "only the platform runs outputs on a schedule", code: "forbidden" });
        return json(200, await host.tick());
      }
      if (root !== "apps") return json(404, { error: "not found", code: "not_found" });
      if (parts.length === 1 && req.method === "GET") return json(200, await host.list(caller));
      if (parts.length === 2) {
        if (req.method === "GET") return json(200, await host.describe(app, caller));
        if (req.method === "DELETE") return (await host.remove(app, caller), new Response(null, { status: 204 }));
        if (req.method === "PUT") {
          const b = (await body()) as { definition?: AppDefinition; migration?: DeployOptions["migration"]; dryRun?: boolean };
          if (!b.definition || b.definition.name !== app) {
            throw new MiniAppError("invalid", `the body is { definition, migration?, dryRun? } and definition.name must be "${app}"`);
          }
          return json(200, await host.deploy(b.definition, { ...caller, migration: b.migration, dryRun: b.dryRun === true }));
        }
      }
      if (parts.length === 3 && sub === "events" && req.method === "GET") {
        const after = url.searchParams.get("after");
        const limit = url.searchParams.get("limit");
        return json(200, await host.events(app, { ...caller, after: after ? Number(after) : undefined, limit: limit ? Number(limit) : undefined }));
      }
      if (parts.length === 4) {
        if (sub === "methods" && req.method === "POST") {
          const b = (await body()) as { args?: Record<string, unknown> };
          return json(200, await host.call(app, name, b.args ?? {}, caller));
        }
        if (sub === "outputs" && req.method === "POST") return json(200, await host.output(app, name, caller));
        if (sub === "grants" && req.method === "PUT") {
          const b = (await body()) as Omit<Grant, "to">;
          return json(200, await host.grant(app, { ...b, to: name }, caller));
        }
        if (sub === "grants" && req.method === "DELETE") return json(200, await host.revoke(app, name, caller));
      }
      return json(404, { error: `no route for ${req.method} ${url.pathname}`, code: "not_found" });
    } catch (err) {
      if (err instanceof MiniAppError) return json(HTTP_STATUS[err.code], err.toJSON());
      return json(500, { error: (err as Error)?.message ?? "internal error", code: "internal" });
    }
  };
}

export interface RemoteAppHostOptions {
  /** Where `serveMiniApps` is mounted, including its base, e.g. `https://gateway.kuiper.sh/apps/v1`. */
  url: string;
  /** Sent as `authorization: Bearer …`. */
  apiKey?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
}

/** An `AppHost` that lives somewhere else. */
export function remoteAppHost(options: RemoteAppHostOptions): AppHost {
  const root = options.url.replace(/\/$/, "");
  const doFetch = options.fetch ?? fetch;
  const send = async <T>(method: string, path: string, caller: Caller | undefined, body?: unknown): Promise<T> => {
    const headers: Record<string, string> = { ...options.headers };
    if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;
    if (caller?.as) headers[AS_HEADER] = caller.as;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await doFetch(`${root}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: caller?.signal,
    });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      const code = (data?.code && data.code in HTTP_STATUS ? data.code : res.status === 403 ? "forbidden" : res.status === 404 ? "not_found" : "failed") as MiniAppErrorCode;
      throw new MiniAppError(code, data?.error ?? `HTTP ${res.status}`, data?.details);
    }
    return data as T;
  };
  const e = encodeURIComponent;
  return {
    list: (c) => send<AppSummary[]>("GET", "/apps", c),
    describe: (app, c) => send<AppDescription>("GET", `/apps/${e(app)}`, c),
    deploy: (definition, c) =>
      send<DeployResult>("PUT", `/apps/${e(definition.name)}`, c, { definition, migration: c.migration, dryRun: c.dryRun }),
    call: <T>(app: string, method: string, args: Record<string, unknown> | undefined, c: Caller) =>
      send<CallResult<T>>("POST", `/apps/${e(app)}/methods/${e(method)}`, c, { args: args ?? {} }),
    events: (app, c) => {
      const qs = new URLSearchParams();
      if (c.after !== undefined) qs.set("after", String(c.after));
      if (c.limit !== undefined) qs.set("limit", String(c.limit));
      return send<AppEvent[]>("GET", `/apps/${e(app)}/events${qs.size ? `?${qs}` : ""}`, c);
    },
    output: (app, name, c) => send<OutputResult>("POST", `/apps/${e(app)}/outputs/${e(name)}`, c, {}),
    grant: (app, grant, c) => send<Grant[]>("PUT", `/apps/${e(app)}/grants/${e(grant.to)}`, c, { methods: grant.methods, events: grant.events }),
    revoke: (app, to, c) => send<Grant[]>("DELETE", `/apps/${e(app)}/grants/${e(to)}`, c),
    remove: (app, c) => send<void>("DELETE", `/apps/${e(app)}`, c),
    tick: () => send<OutputResult[]>("POST", "/tick", undefined, {}),
    close: async () => {},
  };
}
