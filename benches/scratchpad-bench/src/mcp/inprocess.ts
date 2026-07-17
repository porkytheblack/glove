/**
 * A REAL in-process MCP server, wired to a glove-mcp `McpServerConnection`.
 *
 * `connectMcp` in glove-mcp only speaks HTTP, but `McpServerConnection` is just
 * an interface. So we stand up an actual `@modelcontextprotocol/sdk` `McpServer`,
 * link it to a `Client` over `InMemoryTransport` (no sockets, no ports), and wrap
 * that client exactly the way `connect.ts` wraps its HTTP client. The result is a
 * genuine MCP round-trip — real tool schemas, real JSON-RPC `tools/list` and
 * `tools/call`, real content blocks — that both benchmark arms share verbatim.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServerConnection, McpToolDef, McpCallToolResult } from "glove-mcp";
import type { ServerSpec } from "./spec";

/** Count of `tools/call` round-trips per namespace — a ground-truth invocation
 *  meter independent of whatever the agent *thinks* it did. */
export type CallMeter = Map<string, number>;

/**
 * Build a live MCP server from a {@link ServerSpec} and return an
 * {@link McpServerConnection} speaking to it in-process. Every `callTool` is a
 * real protocol round-trip; `meter` (if given) counts them by namespace.
 */
export async function buildConnection(
  spec: ServerSpec,
  meter?: CallMeter,
): Promise<McpServerConnection> {
  const server = new McpServer(
    { name: spec.namespace, version: "1.0.0" },
    { capabilities: {} },
  );

  for (const tool of spec.tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.input,
        ...(tool.readOnly ? { annotations: { readOnlyHint: true } } : {}),
      },
      async (args: Record<string, unknown>) => {
        const data = await tool.handler(args ?? {});
        const text = typeof data === "string" ? data : JSON.stringify(data);
        return { content: [{ type: "text" as const, text }] };
      },
    );
  }

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: `bench-${spec.namespace}`, version: "1.0.0" });
  await client.connect(clientTransport);

  const conn: McpServerConnection = {
    namespace: spec.namespace,
    raw: client,

    async listTools(): Promise<McpToolDef[]> {
      const result = await client.listTools();
      return result.tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown>,
        annotations: t.annotations
          ? {
              readOnlyHint: t.annotations.readOnlyHint,
              destructiveHint: t.annotations.destructiveHint,
              idempotentHint: t.annotations.idempotentHint,
            }
          : undefined,
      }));
    },

    async callTool(name: string, args: unknown): Promise<McpCallToolResult> {
      if (meter) meter.set(spec.namespace, (meter.get(spec.namespace) ?? 0) + 1);
      const result = await client.callTool({
        name,
        arguments: (args ?? {}) as Record<string, unknown>,
      });
      return {
        content: (result.content ?? []) as McpCallToolResult["content"],
        isError: Boolean(result.isError),
      };
    },

    async close() {
      await client.close();
      await server.close();
    },
  };

  return conn;
}
