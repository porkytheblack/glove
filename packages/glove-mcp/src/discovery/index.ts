import { z } from "zod";
import { Glove } from "glove-core/glove";
import type { GloveFoldArgs, IGloveRunnable } from "glove-core/glove";
import type { ModelAdapter, ToolResultData } from "glove-core/core";

import type { McpAdapter, McpCatalogueEntry } from "../adapter";
import { connectMcp } from "../connect";
import { bridgeMcpTool } from "../bridge";
import { bearer } from "../auth";
import { extractText } from "../extract-text";

import type { DiscoveryAmbiguityPolicy } from "./policy";
import { defaultPromptFor } from "./prompt";
import { DiscoveryMemoryStore } from "./memory-store";

export type { DiscoveryAmbiguityPolicy } from "./policy";

// ─── Public config ───────────────────────────────────────────────────────────

export interface DiscoveryToolConfig {
  adapter: McpAdapter;
  entries: McpCatalogueEntry[];
  ambiguityPolicy: DiscoveryAmbiguityPolicy;
  /** Default: inherited from the main glove at do-time via the third argument. */
  subagentModel?: ModelAdapter;
  /** Default: built-in per-policy prompt. */
  subagentSystemPrompt?: string;
  /** Forwarded to connectMcp during activation. */
  clientInfo?: { name: string; version: string };
}

// ─── Subagent-only tools ─────────────────────────────────────────────────────

function matchEntries(
  entries: McpCatalogueEntry[],
  query: string | undefined,
  tags: string[] | undefined,
): McpCatalogueEntry[] {
  const q = (query ?? "").trim().toLowerCase();
  const tagFilter = (tags ?? []).map((t) => t.toLowerCase());

  const scored: Array<{ entry: McpCatalogueEntry; score: number }> = [];
  for (const entry of entries) {
    const haystack =
      `${entry.name} ${entry.description} ${(entry.tags ?? []).join(" ")}`.toLowerCase();

    if (tagFilter.length) {
      const entryTags = (entry.tags ?? []).map((t) => t.toLowerCase());
      const tagsMatch = tagFilter.every((t) => entryTags.includes(t));
      if (!tagsMatch) continue;
    }

    if (!q) {
      scored.push({ entry, score: 1 });
      continue;
    }

    if (haystack.includes(q)) {
      scored.push({ entry, score: q.length });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 10).map((s) => s.entry);
}

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
          auth: bearer(() => adapter.getAccessToken(entry.id)),
          clientInfo,
        });

        const tools = await conn.listTools();
        const toolNames: string[] = [];
        for (const tool of tools) {
          mainGlove.fold(bridgeMcpTool(conn, tool, mainGlove.serverMode));
          toolNames.push(tool.name);
        }

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

export function discoveryTool(
  config: DiscoveryToolConfig,
): GloveFoldArgs<{ need: string }> {
  return {
    name: "find_capability",
    description:
      "Find a capability the assistant doesn't currently have. Pass a brief description of " +
      "what you need to do. If a capability is activated, the relevant tools become available " +
      "on your next turn — just continue the task and use them.",
    inputSchema: z.object({
      need: z.string().describe("Brief description of the capability or service required."),
    }),
    async do(input, _display, mainGlove): Promise<ToolResultData> {
      const subagent = new Glove({
        store: new DiscoveryMemoryStore(`discovery_${Date.now()}`),
        model: config.subagentModel ?? mainGlove.model,
        displayManager: mainGlove.displayManager,
        systemPrompt:
          config.subagentSystemPrompt ?? defaultPromptFor(config.ambiguityPolicy),
        serverMode: mainGlove.serverMode,
        compaction_config: {
          compaction_instructions: "Summarise capability search progress.",
          compaction_context_limit: 30_000,
        },
      });

      subagent.fold(listCapabilitiesTool(config.adapter, config.entries));
      subagent.fold(
        activateTool(config.adapter, config.entries, mainGlove, config.clientInfo),
      );
      subagent.fold(deactivateTool(config.adapter));
      if (config.ambiguityPolicy.type === "interactive") {
        subagent.fold(askUserTool());
      }

      subagent.build();

      const result = await subagent.processRequest(input.need);
      const text = extractText(result);

      return {
        status: "success",
        data: text || "No matching capability found.",
      };
    },
  };
}
