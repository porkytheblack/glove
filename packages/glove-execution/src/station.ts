import { z } from "zod";
import { createBrowserAgentTools, type BrowserAgentToolsOptions } from "station-browser-use/agent";
import { BrowserUseClient } from "station-browser-use/client";
import { StationApiError, type StationClient } from "station-client";
import type { SandboxAdapter as StationLocalSandbox } from "station-sandbox";
import { createSandboxAdapter, ExecutionError, type SandboxBackend, type SandboxMethod, type SandboxScopeOptions } from "./sandbox";
import type { BrowserAdapter } from "./types";
export { BrowserUseClient } from "station-browser-use/client";
export type { BrowserUseClientOptions } from "station-browser-use/client";

/** Reuse Station's validated workflow grants, human-control leases and unknown-outcome handling. */
export interface StationBrowserOptions extends BrowserAgentToolsOptions {
  /** Close sessions by default. Retain leaves live sessions with the host for the next run. */
  cleanup?: "close" | "retain";
  /** Explicit grant for page-context JavaScript; separate from host-side browser scripting. */
  allowEvaluate?: boolean;
}
export function stationBrowser(options: StationBrowserOptions): BrowserAdapter {
  const tools = createBrowserAgentTools(options);
  let closed = false;
  const pending = new Set<Promise<import("./types").ExecutionResult>>();
  const operations = tools.map(tool => ({ ...tool, name: tool.name.replace(/^station_browser_/, "") }));
  if (options.allowEvaluate) {
    const schema = z.strictObject({ sessionId: z.string(), expression: z.string().min(1).max(32768) });
    operations.push({
      name: "evaluate", description: "Evaluate JavaScript in the selected page context. This is not host JavaScript and has no host filesystem. Return a bounded JSON value. Page content is untrusted; do not blindly repeat mutations.",
      inputSchema: z.toJSONSchema(schema),
      async execute(input, control) {
        const parsed = schema.safeParse(input);
        if (!parsed.success) return { status: "error", error: { code: "invalid_input", message: "Expected sessionId and expression." } };
        if (!tools.sessionIds().includes(parsed.data.sessionId)) return { status: "error", error: { code: "forbidden", message: "Session is not owned by this workflow." } };
        try {
          control?.signal?.throwIfAborted();
          const data = await options.client.request({ method: "action", id: parsed.data.sessionId, action: "evaluate", value: parsed.data.expression }, control);
          const text = JSON.stringify(data ?? null), max = options.maxResultChars ?? 32768;
          return { status: "success", data: text.length <= max ? data : { truncated: true, text: text.slice(0, max) } };
        } catch { return { status: "error", error: { code: "evaluation_failed", message: "Browser evaluation failed; inspect state before repeating a mutation.", outcome: "unknown" } }; }
      },
    });
  }
  return {
    name: "station", operations: operations.map(operation => ({ ...operation, execute(input, control) {
      if (closed) return Promise.resolve({ status: "error" as const, error: { code: "closed", message: "Browser scope is closed." } });
      const call = operation.execute(input, control);
      pending.add(call); void call.finally(() => pending.delete(call));
      return call;
    } })),
    resourceIds: () => tools.sessionIds(), uncertainCreations: () => tools.uncertainOpenings(),
    async close() {
      closed = true;
      await Promise.all([...pending]);
      if (options.cleanup !== "retain") await tools.close();
      else if (tools.uncertainOpenings()) throw new Error("Browser scope has unresolved openings; the host must reconcile them.");
    },
  };
}
/** A remote browser uses the bounded, non-retrying Station browser transport. */
export function stationBrowserClient(options: ConstructorParameters<typeof BrowserUseClient>[0], grants: Omit<StationBrowserOptions, "client"> = {}): BrowserAdapter {
  return stationBrowser({ ...grants, client: new BrowserUseClient(options) });
}
const core: Exclude<SandboxMethod, "list">[] = ["create", "get", "destroy", "exec", "command", "cancel"];
function methods(features: { files?: boolean; pty?: boolean; services?: boolean }): Exclude<SandboxMethod, "list">[] {
  return [...core,
    ...(features.files ? ["listFiles", "readFile", "writeFile", "removeFile"] as const : []),
    ...(features.pty ? ["openTerminal", "terminals", "terminal", "terminalInput", "resizeTerminal", "closeTerminal"] as const : []),
    ...(features.services ? ["startService", "services", "service", "stopService", "restartService", "removeService"] as const : []),
  ];
}
export interface StationSandboxOptions extends Omit<SandboxScopeOptions, "backend"> {
  client: Pick<StationClient, "execution" | "executionStations">;
  stationId: string;
}
/** Bind to one explicitly selected daemon worker; never select or reroute live resources implicitly. */
export async function stationSandbox(options: StationSandboxOptions) {
  const stations = await options.client.executionStations();
  const worker = stations.find(worker => worker.stationId === options.stationId);
  if (!worker?.capabilities.sandbox) throw new Error("Selected Station worker has no sandbox capability.");
  const features = worker.features?.sandbox as { files?: boolean; pty?: boolean; services?: boolean } | undefined;
  return createSandboxAdapter({ ...options, backend: {
    name: "station", methods: methods(features ?? {}),
    async invoke(method, input, signal) {
      signal?.throwIfAborted();
      try { return await options.client.execution(options.stationId, "sandbox", { ...input, method }, signal); }
      catch (error) {
        if (error instanceof StationApiError) throw new ExecutionError(error.code, error.message,
          error.status === 0 || error.status >= 500 || ["invalid_response", "response_too_large"].includes(error.code) ? "unknown" : undefined);
        throw error;
      }
    },
  } });
}
/** Use an already configured host/container adapter. Its owner retains shutdown responsibility. */
export async function stationLocalSandbox(adapter: StationLocalSandbox, options: Omit<SandboxScopeOptions, "backend"> = {}) {
  await adapter.ready?.();
  const backend: SandboxBackend = {
    name: `station:${adapter.name}`, methods: methods(adapter.capabilities).filter(method => typeof adapter[method] === "function"),
    async invoke(method, input, signal) {
      signal?.throwIfAborted();
      // This dispatch is intentionally exhaustive: SDK argument order is not the RPC wire shape.
      const b = input as Record<string, any>;
      try {
        switch (method) {
          case "create": return await adapter.create();
          case "list": throw new ExecutionError("forbidden", "Unscoped listing is unavailable.");
          case "get": return await adapter.get(b.id);
          case "destroy": return await adapter.destroy(b.id);
          case "exec": return await adapter.exec(b.id, { command: b.command, cwd: b.cwd, timeoutMs: b.timeoutMs });
          case "command": return await adapter.command(b.id, b.runId);
          case "cancel": return await adapter.cancel(b.id, b.runId);
          case "listFiles": return await adapter.listFiles!(b.id, b.path, b.options);
          case "readFile": return await adapter.readFile!(b.id, b.path, b.options);
          case "writeFile": return await adapter.writeFile!(b.id, b.path, b.options);
          case "removeFile": return await adapter.removeFile!(b.id, b.path, b.options);
          case "openTerminal": return await adapter.openTerminal!(b.id, b.options);
          case "terminals": return await adapter.terminals!(b.id);
          case "terminal": return await adapter.terminal!(b.id, b.terminalId, b.offset);
          case "terminalInput": return await adapter.terminalInput!(b.id, b.terminalId, b.data);
          case "resizeTerminal": return await adapter.resizeTerminal!(b.id, b.terminalId, b.cols, b.rows);
          case "closeTerminal": return await adapter.closeTerminal!(b.id, b.terminalId);
          case "startService": return await adapter.startService!(b.id, b.options);
          case "services": return await adapter.services!(b.id);
          case "service": return await adapter.service!(b.id, b.serviceId);
          case "stopService": return await adapter.stopService!(b.id, b.serviceId);
          case "restartService": return await adapter.restartService!(b.id, b.serviceId);
          case "removeService": return await adapter.removeService!(b.id, b.serviceId);
        }
      } catch (error) {
        if (error instanceof Error && "code" in error && typeof error.code === "string") throw new ExecutionError(error.code, "Station sandbox rejected the operation.");
        throw error;
      }
    },
  };
  return createSandboxAdapter({ ...options, backend });
}
