import { z } from "zod";
import type { GloveFoldArgs } from "glove-core/glove";
import type { ToolResultData } from "glove-core/core";
import type { McpServerConnection } from "./connect.js";

export interface McpUtilityPolicy {
  /** Default true when the server negotiated the resources capability. */
  readonly resources?: boolean;
  /** Default true when the server negotiated the prompts capability. */
  readonly prompts?: boolean;
  /** Avoid collisions with callable server tools already using a utility name. */
  readonly occupiedNames?: Iterable<string>;
}

function expose<T>(tool: GloveFoldArgs<T>): GloveFoldArgs<unknown> {
  return tool as unknown as GloveFoldArgs<unknown>;
}

function success(value: unknown, metadata?: Record<string, unknown>): ToolResultData {
  const data = JSON.stringify(value, null, 2);
  return {
    status: "success",
    data: metadata ? `${data}\n\nMCP vendor metadata: ${JSON.stringify(metadata)}` : data,
  };
}

function failure(error: unknown): ToolResultData {
  return {
    status: "error",
    message: error instanceof Error ? error.message : String(error),
    data: null,
  };
}

/**
 * Build capability-aware model tools for MCP resources and prompts.
 *
 * The underlying operations stay on `McpServerConnection`, so their text and
 * metadata cross the same sanitizer as callable MCP tool results.
 */
export function mcpUtilityTools(
  connection: McpServerConnection,
  policy: McpUtilityPolicy = {},
): GloveFoldArgs<unknown>[] {
  const occupied = new Set(policy.occupiedNames ?? []);
  const tools: GloveFoldArgs<unknown>[] = [];
  const add = (name: string, tool: GloveFoldArgs<unknown>) => {
    if (!occupied.has(name)) tools.push(tool);
  };

  const listResources = connection.listResources?.bind(connection);
  const readResource = connection.readResource?.bind(connection);
  if (connection.capabilities?.resources && listResources && readResource && policy.resources !== false) {
    add("list_resources", expose<{ cursor?: string }>({
      name: `${connection.namespace}__list_resources`,
      description: `List resources exposed by the ${connection.namespace} MCP server.`,
      inputSchema: z.object({ cursor: z.string().optional() }),
      requiresPermission: false,
      async do(input) {
        try {
          const result = await listResources(input.cursor);
          return success({ resources: result.resources, nextCursor: result.nextCursor }, result.metadata);
        } catch (error) {
          return failure(error);
        }
      },
    }));
    add("read_resource", expose<{ uri: string }>({
      name: `${connection.namespace}__read_resource`,
      description: `Read one resource by URI from the ${connection.namespace} MCP server.`,
      inputSchema: z.object({ uri: z.string().min(1) }),
      requiresPermission: false,
      async do(input) {
        try {
          const result = await readResource(input.uri);
          return success({ contents: result.contents }, result.metadata);
        } catch (error) {
          return failure(error);
        }
      },
    }));
  }

  const listPrompts = connection.listPrompts?.bind(connection);
  const getPrompt = connection.getPrompt?.bind(connection);
  if (connection.capabilities?.prompts && listPrompts && getPrompt && policy.prompts !== false) {
    add("list_prompts", expose<{ cursor?: string }>({
      name: `${connection.namespace}__list_prompts`,
      description: `List reusable prompts exposed by the ${connection.namespace} MCP server.`,
      inputSchema: z.object({ cursor: z.string().optional() }),
      requiresPermission: false,
      async do(input) {
        try {
          const result = await listPrompts(input.cursor);
          return success({ prompts: result.prompts, nextCursor: result.nextCursor }, result.metadata);
        } catch (error) {
          return failure(error);
        }
      },
    }));
    add("get_prompt", expose<{ name: string; arguments?: Record<string, string> }>({
      name: `${connection.namespace}__get_prompt`,
      description: `Get a reusable prompt with arguments from the ${connection.namespace} MCP server.`,
      inputSchema: z.object({
        name: z.string().min(1),
        arguments: z.record(z.string(), z.string()).optional(),
      }),
      requiresPermission: false,
      async do(input) {
        try {
          const result = await getPrompt(input.name, input.arguments);
          return success({ description: result.description, messages: result.messages }, result.metadata);
        } catch (error) {
          return failure(error);
        }
      },
    }));
  }

  return tools;
}
