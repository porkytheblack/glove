import { z } from "zod";
import type { ExecutionOperation, ExecutionResult, SandboxAdapter } from "./types";
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const path = z.string().max(4096);
const offset = z.number().int().nonnegative();
const positive = z.number().int().positive();
const base = { id };
const command = { command: z.string().min(1).max(32768), cwd: path.optional() };
const terminal = { ...base, terminalId: id };
const service = { ...base, serviceId: id };
export const sandboxSchemas = {
  create: z.strictObject({}), list: z.strictObject({}), get: z.strictObject(base), destroy: z.strictObject(base),
  exec: z.strictObject({ ...base, ...command, timeoutMs: positive.max(300000).optional() }),
  command: z.strictObject({ ...base, runId: id }), cancel: z.strictObject({ ...base, runId: id }),
  listFiles: z.strictObject({ ...base, path: path.optional(), options: z.strictObject({ offset: offset.optional(), limit: positive.max(1000).optional() }).optional() }),
  readFile: z.strictObject({ ...base, path, options: z.strictObject({ offset: offset.optional(), length: positive.max(4 * 1024 * 1024).optional() }).optional() }),
  writeFile: z.strictObject({ ...base, path, options: z.strictObject({ base64: z.string().max(5592408).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/), createParents: z.boolean().optional() }) }),
  removeFile: z.strictObject({ ...base, path, options: z.strictObject({ recursive: z.boolean().optional() }).optional() }),
  openTerminal: z.strictObject({ ...base, options: z.strictObject({ cwd: path.optional(), cols: positive.max(500).optional(), rows: positive.max(300).optional() }).optional() }),
  terminals: z.strictObject(base), terminal: z.strictObject({ ...terminal, offset: offset.optional() }),
  terminalInput: z.strictObject({ ...terminal, data: z.string().max(65536) }),
  resizeTerminal: z.strictObject({ ...terminal, cols: positive.max(500), rows: positive.max(300) }),
  closeTerminal: z.strictObject(terminal),
  startService: z.strictObject({ ...base, options: z.strictObject({ name: z.string().min(1).max(128), ...command, restart: z.strictObject({ policy: z.enum(["never", "on-failure", "always"]), maxRestarts: offset.max(100), delayMs: positive.max(300000) }).optional() }) }),
  services: z.strictObject(base), service: z.strictObject(service), stopService: z.strictObject(service), restartService: z.strictObject(service), removeService: z.strictObject(service),
};
export type SandboxMethod = keyof typeof sandboxSchemas;
export type SandboxInput<M extends SandboxMethod> = z.infer<(typeof sandboxSchemas)[M]>;
/** Backends implement operations; the workflow wrapper owns grants and lifecycle. */
export interface SandboxBackend {
  readonly name: string;
  readonly methods: readonly Exclude<SandboxMethod, "list">[];
  invoke<M extends SandboxMethod>(method: M, input: SandboxInput<M>, signal?: AbortSignal): Promise<unknown>;
}
export class ExecutionError extends Error {
  constructor(readonly code: string, message: string, readonly outcome?: "unknown") { super(message); }
}
export interface SandboxScopeOptions {
  backend: SandboxBackend;
  sandboxIds?: readonly string[];
  maxSandboxes?: number;
  /** Default retain: files/services survive run completion. Never closes a shared backend. */
  cleanup?: "retain" | "destroy-created";
  maxResultChars?: number;
}
const descriptions: Partial<Record<SandboxMethod, string>> = {
  create: "Create a persistent sandbox. Save its id. An uncertain create must be reconciled by the host before creating another.",
  list: "Inspect only sandboxes created by or explicitly granted to this workflow.",
  exec: "For Station, cwd is workspace-relative; omit it or use a relative subdirectory. Start a shell command; returns a run id. Poll command until finishedAt/status is terminal. Never blindly retry a mutation.",
  command: "Inspect command status and bounded output. Running is not completion.",
  destroy: "Permanently delete an owned sandbox and its files, commands, terminals and services.",
  readFile: "Read a bounded file chunk as base64, with totalBytes and nextOffset.",
  writeFile: "Write a file from base64 content. Paths are relative to the sandbox.",
};
export function createSandboxAdapter(options: SandboxScopeOptions): SandboxAdapter {
  const { backend } = options;
  const max = z.number().int().min(1).max(64).parse(options.maxSandboxes ?? 2);
  const maxChars = z.number().int().min(1024).max(262144).parse(options.maxResultChars ?? 32768);
  const owned = new Set((options.sandboxIds ?? []).map(value => id.parse(value)));
  if (owned.size > max) throw new Error("Granted sandboxes exceed capacity.");
  const created = new Set<string>();
  const pending = new Set<Promise<ExecutionResult>>();
  let closed = false, opening = 0, uncertain = 0;
  let closing: Promise<void> | undefined;
  const limit = (data: unknown) => {
    const text = JSON.stringify(data ?? null);
    return text.length <= maxChars ? data ?? null : { truncated: true, originalChars: text.length, text: text.slice(0, maxChars), hint: "Request a smaller file chunk or narrower output." };
  };
  const methods = [...new Set<SandboxMethod>([...backend.methods, "list"])];
  const operations: ExecutionOperation[] = methods.map(method => ({
    name: method, description: descriptions[method] ?? `${method} within an owned sandbox. Inspect results before repeating mutations.`,
    inputSchema: z.toJSONSchema(sandboxSchemas[method]) as Record<string, unknown>,
    execute(input, control) {
      const call = (async (): Promise<ExecutionResult> => {
        try {
          if (closed) throw new ExecutionError("closed", "Sandbox scope is closed.");
          control?.signal?.throwIfAborted();
          const parsed = sandboxSchemas[method].parse(input);
          if ("id" in parsed && !owned.has(parsed.id)) throw new ExecutionError("forbidden", "Sandbox is not granted to this workflow.");
          if (method === "list") {
            const data = await Promise.all([...owned].map(id => backend.invoke("get", { id }, control?.signal)));
            return { status: "success", data: limit(data) };
          }
          if (method === "create") {
            if (uncertain) throw new ExecutionError("unresolved_sandboxes", "Reconcile the previous uncertain create before admitting more work.", "unknown");
            if (owned.size + opening >= max) throw new ExecutionError("capacity", "Sandbox scope capacity reached.");
            opening++;
            try {
              const data = await backend.invoke("create", {}, control?.signal);
              const resource = z.object({ id }).safeParse(data);
              if (!resource.success) throw new ExecutionError("invalid_response", "Sandbox create returned no usable id.", "unknown");
              owned.add(resource.data.id); created.add(resource.data.id);
              return { status: "success", data: limit(data) };
            } catch (error) {
              if (!(error instanceof ExecutionError) || error.outcome === "unknown") uncertain++;
              throw error;
            } finally { opening--; }
          }
          const data = await backend.invoke<SandboxMethod>(method, parsed, control?.signal);
          if (method === "destroy" && "id" in parsed) { owned.delete(parsed.id); created.delete(parsed.id); }
          return { status: "success", data: limit(data) };
        } catch (error) {
          return { status: "error", error: error instanceof ExecutionError
            ? { code: error.code, message: error.message, ...(error.outcome ? { outcome: error.outcome } : {}) }
            : error instanceof z.ZodError ? { code: "invalid_input", message: "Invalid sandbox arguments. Inspect the operation schema." }
            : { code: "unavailable", message: "Sandbox operation failed. Inspect state before repeating a mutation.", outcome: "unknown" } };
        }
      })();
      pending.add(call); void call.finally(() => pending.delete(call));
      return call;
    },
  }));
  // Source code should not require model-authored base64 or host globals in the REPL.
  // Delegate to the existing scoped operation so grants, cancellation and cleanup
  // keep exactly the same boundary as binary file writes.
  const writeFile = operations.find(operation => operation.name === "writeFile");
  if (writeFile) {
    const schema = z.strictObject({ id, path, text: z.string().max(65536), createParents: z.boolean().optional() });
    operations.push({
      name: "writeText", description: "Write UTF-8 source code or text directly. Use a workspace-relative path (for example server.mjs). No base64, Buffer or btoa is needed.",
      inputSchema: z.toJSONSchema(schema),
      async execute(input, control) {
        const parsed = schema.safeParse(input);
        if (!parsed.success) return { status: "error", error: { code: "invalid_input", message: "Expected id, path, text (up to 65536 characters), and optional createParents." } };
        const bytes = new TextEncoder().encode(parsed.data.text);
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        return writeFile.execute({ id: parsed.data.id, path: parsed.data.path, options: { base64: btoa(binary), createParents: parsed.data.createParents } }, control);
      },
    });
  }
  return {
    name: backend.name, operations, resourceIds: () => [...owned], uncertainCreations: () => uncertain,
    close() {
      closed = true;
      if (closing) return closing;
      closing = (async () => {
        await Promise.all([...pending]);
        const failures: unknown[] = [];
        if (options.cleanup === "destroy-created") for (const id of created) {
          try { await backend.invoke("destroy", { id }); created.delete(id); owned.delete(id); }
          catch (error) { failures.push(error); }
        }
        if (uncertain) failures.push(new ExecutionError("unresolved_sandboxes", "Sandbox creates have unknown outcomes; host reconciliation is required.", "unknown"));
        if (failures.length) throw new AggregateError(failures, "Sandbox cleanup incomplete.");
      })();
      void closing.then(() => { closing = undefined; }, () => { closing = undefined; });
      return closing;
    },
  };
}
