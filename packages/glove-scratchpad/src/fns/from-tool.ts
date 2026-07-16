/**
 * Glove tool → {@link ToolFn}. The tool's own input schema (Zod or raw JSON
 * Schema) becomes the function's contract verbatim — no columns, no keys.
 */
import { z } from "zod";
import type { GloveFoldArgs, IGloveRunnable } from "glove-core/glove";
import { assertFnName, summarizeZodError, type ToolFn } from "./catalog";

// The display argument of a tool's `do` — derived from the type so we don't
// have to import DisplayManagerAdapter directly. Fn resolvers run headless, so
// these are inert stand-ins (same shape as db/resource.ts's — duplicated to
// keep the hardened db/ files untouched); a tool that tries an interactive
// display surfaces a clear error rather than hanging.
type DisplayArg = Parameters<GloveFoldArgs<unknown>["do"]>[1];
const NOOP_DISPLAY = new Proxy(
  {},
  { get: () => async () => undefined },
) as unknown as DisplayArg;
const NOOP_GLOVE = new Proxy(
  {},
  { get: () => async () => undefined },
) as unknown as IGloveRunnable;

/**
 * MCP tools return joined text; when it looks like JSON, hand the model data
 * instead of a string to re-parse. Garbage falls back to the raw string.
 */
export function parseToolData(data: unknown): unknown {
  if (typeof data !== "string") return data;
  const t = data.trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      return JSON.parse(t);
    } catch {
      return data;
    }
  }
  return data;
}

export interface FnFromToolOptions {
  /** Override the callable name (default: the tool's own name). */
  name?: string;
  /**
   * Override the description (default: the tool's own). Lets callers pass the
   * original, un-decorated description when the bridged tool's own description
   * carries a rendered result shape they instead surface via {@link resultShape}.
   */
  description?: string;
  /** Effect hint surfaced in `fns()` / the primed catalog. */
  readOnlyHint?: boolean;
  /** Override result parsing. Default {@link parseToolData}. */
  parse?: (data: unknown) => unknown;
  /** Origin server (namespace) for progressive discovery grouping. */
  server?: string;
  /** One-line description of the origin server. */
  serverDescription?: string;
  /**
   * Seed the result shape (e.g. from an MCP tool's declared `outputSchema`) so
   * the surfaces show it without a live sample. When set, {@link ../fns/shape!sampleOne}
   * leaves it untouched.
   */
  resultShape?: string;
}

/** Read a tool's input schema as JSON Schema, whichever way it was declared. */
function toolInputJsonSchema(tool: GloveFoldArgs<unknown>): Record<string, unknown> | undefined {
  const js = (tool as { jsonSchema?: Record<string, unknown> }).jsonSchema;
  if (js && typeof js === "object") return js;
  const zs = (tool as { inputSchema?: z.ZodType }).inputSchema;
  if (zs) {
    try {
      return z.toJSONSchema(zs, { unrepresentable: "any" }) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Wrap one Glove tool (hand-written or MCP-bridged) as a {@link ToolFn}.
 * A Zod `inputSchema` also validates args at call time — the executor isn't in
 * this path, so the check the tool's `do` relies on happens here.
 */
export function fnFromTool<I>(tool: GloveFoldArgs<I>, opts: FnFromToolOptions = {}): ToolFn {
  const name = opts.name ?? tool.name;
  assertFnName(name);
  const zod = (tool as { inputSchema?: z.ZodType }).inputSchema;
  const parse = opts.parse ?? parseToolData;
  return {
    name,
    description: opts.description ?? tool.description,
    inputSchema: toolInputJsonSchema(tool as GloveFoldArgs<unknown>),
    readOnlyHint: opts.readOnlyHint,
    ...(opts.server !== undefined ? { server: opts.server } : {}),
    ...(opts.serverDescription !== undefined ? { serverDescription: opts.serverDescription } : {}),
    ...(opts.resultShape !== undefined ? { resultShape: opts.resultShape } : {}),
    async call(args, ctx = {}) {
      let input: unknown = args;
      if (zod && typeof zod.safeParse === "function") {
        const parsed = zod.safeParse(args);
        if (!parsed.success) throw new Error(summarizeZodError(parsed.error));
        input = parsed.data;
      }
      const res = await tool.do(input as I, NOOP_DISPLAY, NOOP_GLOVE, ctx.signal);
      if (res.status !== "success") {
        throw new Error(res.message ?? `tool "${tool.name}" failed`);
      }
      return parse(res.data);
    },
  };
}
