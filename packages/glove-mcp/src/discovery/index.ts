import { z } from "zod";
import { Glove } from "glove-core/glove";
import type { GloveFoldArgs, IGloveRunnable } from "glove-core/glove";
import type { DefineSubAgentArgs } from "glove-core/extensions";
import type { ModelAdapter, StoreAdapter, ToolResultData } from "glove-core/core";

import type { McpAdapter, McpCatalogueEntry } from "../adapter";
import { connectMcp } from "../connect";
import { bridgeMcpTool, type McpToolWrapper } from "../bridge";
import { adapterAuth } from "../auth";

import type { DiscoveryAmbiguityPolicy } from "./policy";
import { defaultPromptFor } from "./prompt";
import { DiscoveryMemoryStore } from "./memory-store";
import { matchEntries } from "./match";

export type { DiscoveryAmbiguityPolicy } from "./policy";

// ─── Public config ───────────────────────────────────────────────────────────

export interface DiscoverySubAgentConfig {
  adapter: McpAdapter;
  entries: McpCatalogueEntry[];
  ambiguityPolicy: DiscoveryAmbiguityPolicy;
  /** Default: inherited from the parent glove at invocation time. */
  subagentModel?: ModelAdapter;
  /** Default: built-in per-policy prompt. */
  subagentSystemPrompt?: string;
  /** Forwarded to connectMcp during activation. */
  clientInfo?: { name: string; version: string };
  /** Transform each bridged tool before it's folded onto the main agent (e.g. containment). */
  wrapTool?: McpToolWrapper;
}

// ─── Subagent-only tools ─────────────────────────────────────────────────────

function listCapabilitiesTool(
  adapter: McpAdapter,
  entries: McpCatalogueEntry[],
): GloveFoldArgs<{ query?: string; tags?: string[] }> {
  return {
    name: "list_capabilities",
    description:
      "Search the capability catalogue. Returns up to 10 entries matching the substring " +
      "of `query` against name/description/tags, optionally filtered by `tags`.",
    inputSchema: z.object({
      query: z.string().optional().describe("Substring to match in name/description/tags."),
      tags: z.array(z.string()).optional().describe("All-of tag filter."),
    }),
    async do(input) {
      const matches = matchEntries(entries, input.query, input.tags);
      const active = new Set(await adapter.getActive());

      const items = matches.map((entry) => ({
        id: entry.id,
        name: entry.name,
        description: entry.description,
        tags: entry.tags ?? [],
        active: active.has(entry.id),
      }));

      return {
        status: "success",
        data: JSON.stringify(items, null, 2),
      };
    },
  };
}

function activateTool(
  adapter: McpAdapter,
  entries: McpCatalogueEntry[],
  mainGlove: IGloveRunnable,
  clientInfo?: { name: string; version: string },
  wrapTool?: McpToolWrapper,
): GloveFoldArgs<{ id: string }> {
  return {
    name: "activate",
    description:
      "Activate a capability by id. Connects to the MCP server, bridges its tools onto the " +
      "main assistant, and persists the active state. Returns a one-line summary.",
    inputSchema: z.object({
      id: z.string().describe("Catalogue entry id."),
    }),
    async do(input): Promise<ToolResultData> {
      const entry = entries.find((e) => e.id === input.id);
      if (!entry) {
        return {
          status: "error",
          message: `No capability with id "${input.id}".`,
          data: null,
        };
      }

      try {
        const conn = await connectMcp({
          namespace: entry.id,
          url: entry.url,
          auth: adapterAuth(adapter, entry.id),
          clientInfo,
        });

        const tools = await conn.listTools();
        // Build the full wrapped set first; fold only after every wrapTool call
        // succeeds, so a throwing wrapper can't leave the session with a
        // half-activated provider the adapter doesn't know about.
        const wrapped = tools.map((tool) => {
          const bridged = bridgeMcpTool(conn, tool, mainGlove.serverMode);
          return wrapTool ? wrapTool(bridged, entry) : bridged;
        });
        for (const t of wrapped) mainGlove.fold(t);
        const toolNames = tools.map((tool) => tool.name);

        await adapter.activate(entry.id);

        return {
          status: "success",
          data:
            `Activated ${entry.name}. New tools: ` +
            (toolNames.length ? toolNames.map((n) => `${entry.id}__${n}`).join(", ") : "(none)"),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          status: "error",
          message: `Failed to activate ${entry.name}: ${message}`,
          data: null,
        };
      }
    },
  };
}

function deactivateTool(
  adapter: McpAdapter,
): GloveFoldArgs<{ id: string }> {
  return {
    name: "deactivate",
    description:
      "Mark a capability inactive in the persisted state. Note: tools remain loaded on the " +
      "running assistant until the session is refreshed (v1 limitation).",
    inputSchema: z.object({
      id: z.string().describe("Catalogue entry id."),
    }),
    async do(input): Promise<ToolResultData> {
      await adapter.deactivate(input.id);
      return {
        status: "success",
        data:
          `Deactivated ${input.id}. (Tools remain loaded until next session.)`,
      };
    },
  };
}

interface AskUserOption {
  label: string;
  value: string;
}

function askUserTool(): GloveFoldArgs<{ question: string; options: AskUserOption[] }> {
  return {
    name: "ask_user",
    description:
      "Ask the user to pick one option to disambiguate. Renders via the `mcp_picker` " +
      "renderer. Returns the chosen option's value as text.",
    inputSchema: z.object({
      question: z.string().describe("Question shown to the user."),
      options: z
        .array(
          z.object({
            label: z.string(),
            value: z.string(),
          }),
        )
        .min(2)
        .describe("Choices the user picks from."),
    }),
    async do(input, display): Promise<ToolResultData> {
      const value = await display.pushAndWait<
        { renderer: string; question: string; options: AskUserOption[] },
        string
      >({
        renderer: "mcp_picker",
        input: {
          renderer: "mcp_picker",
          question: input.question,
          options: input.options,
        },
      });
      return {
        status: "success",
        data: typeof value === "string" ? value : JSON.stringify(value),
      };
    },
  };
}

// ─── Public factory ──────────────────────────────────────────────────────────

/**
 * Build the `discovermcp` subagent definition. Pass to
 * `glove.defineSubAgent(...)` so the parent agent invokes it via the
 * first-class `glove_invoke_subagent` dispatch tool.
 *
 * Each invocation:
 *   1. Asks the parent store for a fresh, non-durable sub-store via
 *      `createSubAgentStore("discovermcp", false)`. Falls back to an
 *      in-memory store if the parent store doesn't implement sub-stores —
 *      that preserves the previous "constructed fresh per call" behavior.
 *   2. Builds a child Glove with the same model / displayManager /
 *      serverMode as the parent (overridable via config).
 *   3. Folds the discovery tools (list_capabilities, activate, deactivate,
 *      and ask_user when interactive). The activate tool reaches back to
 *      the parent glove to fold bridged MCP tools onto it.
 *   4. The dispatcher attaches parent subscribers to the child for the
 *      duration of the run, brackets it with subagent_invoked /
 *      subagent_completed events, and returns the child's final agent
 *      message text as the tool result.
 */
export function discoverySubAgent(
  config: DiscoverySubAgentConfig,
): DefineSubAgentArgs {
  return {
    name: "discovermcp",
    description:
      "Discover and activate an MCP server the parent assistant doesn't currently have. " +
      "Hand the subagent a brief description of what you need; if it activates a server, " +
      "the relevant tools become available on the parent's next turn.",
    factory: async ({ parentStore, parentControls }): Promise<IGloveRunnable> => {
      const parentGlove = parentControls.glove;

      const store: StoreAdapter =
        (await parentStore.createSubAgentStore?.("discovermcp", false)) ??
        new DiscoveryMemoryStore(`discovermcp_${Date.now()}`);

      const subagent = new Glove({
        store,
        model: config.subagentModel ?? parentGlove.model,
        displayManager: parentGlove.displayManager,
        systemPrompt:
          config.subagentSystemPrompt ?? defaultPromptFor(config.ambiguityPolicy),
        serverMode: parentGlove.serverMode,
        compaction_config: {
          compaction_instructions: "Summarise capability search progress.",
          compaction_context_limit: 30_000,
        },
      });

      subagent.fold(listCapabilitiesTool(config.adapter, config.entries));
      subagent.fold(
        activateTool(config.adapter, config.entries, parentGlove, config.clientInfo, config.wrapTool),
      );
      subagent.fold(deactivateTool(config.adapter));
      if (config.ambiguityPolicy.type === "interactive") {
        subagent.fold(askUserTool());
      }

      return subagent.build();
    },
  };
}
