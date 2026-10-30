// Translating Glove's primitives into what a realtime adapter takes.

import {
  getToolJsonSchema,
  type ContentPart,
  type InboxItem,
  type Message,
  type Tool,
  type ToolResultData,
} from "glove-core";
import type { RealtimeHistoryItem, RealtimeToolSpec } from "./types";

/** A Glove tool as the provider sees it. */
export function toToolSpec(tool: Tool<unknown>, nonBlocking: boolean): RealtimeToolSpec {
  return {
    name: tool.name,
    description: tool.description,
    parameters: getToolJsonSchema(tool),
    ...(nonBlocking ? { behavior: "non_blocking" as const } : {}),
  };
}

/**
 * The model-facing half of a tool result. `renderData` and the summary
 * plumbing are client-only — tools rely on that to keep UI-only data away
 * from every model, and a realtime provider is no exception.
 */
export function toWireResult(result: ToolResultData): Omit<ToolResultData, "renderData" | "summary" | "generateSummaryArgs"> {
  const { renderData: _rd, summary: _s, generateSummaryArgs: _g, ...wire } = result;
  return wire;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return String(value);
  }
}

export interface HistoryOptions {
  /** Most recent items kept. Default 30. */
  maxItems?: number;
  /** Total characters kept, newest first. Default 12 000. */
  maxChars?: number;
  /** Characters per tool result. Default 400. */
  maxToolChars?: number;
}

/**
 * Stored Glove messages → seed history for a fresh provider session.
 *
 * Providers disagree on how (or whether) function calls can be replayed, so
 * tool activity is rendered as system text: what was called, with what, and
 * what came back. That keeps the facts without asking any provider to accept
 * call ids it never issued. Runtime snapshots are skipped — they are
 * re-injected live — and a compaction summary becomes a system item.
 */
export function toHistory(messages: ReadonlyArray<Message>, options: HistoryOptions = {}): RealtimeHistoryItem[] {
  const maxItems = options.maxItems ?? 30;
  const maxChars = options.maxChars ?? 12_000;
  const maxToolChars = options.maxToolChars ?? 400;
  const items: RealtimeHistoryItem[] = [];

  for (const message of messages) {
    // Transient runtime snapshots never reached history; context saved with
    // `delivery: "history"` (keyed, not transient) did, and a text turn reads it.
    if ((message.framework_context === "runtime" && (message.transient || !message.context_key)) || message.is_compaction_request) continue;
    if (message.is_compaction) {
      items.push({ role: "system", text: message.text });
      continue;
    }
    if (message.tool_results?.length) {
      for (const result of message.tool_results) {
        const outcome = result.result.status === "success"
          ? stringify(result.result.data)
          : `${result.result.status}: ${result.result.message ?? stringify(result.result.data)}`;
        items.push({ role: "system", text: `Tool ${result.tool_name} returned: ${clip(outcome, maxToolChars)}` });
      }
      continue;
    }
    if (message.tool_calls?.length) {
      if (message.text) items.push({ role: "assistant", text: message.text });
      for (const call of message.tool_calls) {
        items.push({ role: "system", text: `Assistant called ${call.tool_name}(${clip(stringify(call.input_args), maxToolChars)})` });
      }
      continue;
    }
    const text = message.text?.trim();
    if (!text) continue;
    if (message.framework_context || message.is_skill_injection) {
      items.push({ role: "system", text });
    } else {
      items.push({ role: message.sender === "agent" ? "assistant" : "user", text });
    }
  }

  // Newest first until a budget runs out, then back into order.
  const kept: RealtimeHistoryItem[] = [];
  let chars = 0;
  for (let i = items.length - 1; i >= 0 && kept.length < maxItems; i--) {
    chars += items[i].text.length;
    if (chars > maxChars && kept.length > 0) break;
    kept.push(items[i]);
  }
  return kept.reverse();
}

/** Plain-text rendering of history, for summaries built without a model. */
export function renderTranscript(items: ReadonlyArray<RealtimeHistoryItem>): string {
  return items.map((item) => `${item.role}: ${item.text}`).join("\n");
}

/** The text half of resolved runtime-context messages. */
export function runtimeText(messages: ReadonlyArray<Message>): string {
  return messages.map((message) => message.text ?? "").filter(Boolean).join("\n\n");
}

/** Image parts in runtime context — sent as media where the provider takes images. */
export function runtimeImages(messages: ReadonlyArray<Message>): ContentPart[] {
  const images: ContentPart[] = [];
  for (const message of messages) {
    for (const part of message.content ?? []) {
      if (part.type === "image" && part.source?.type === "base64" && part.source.data) images.push(part);
    }
  }
  return images;
}

/** Same rendering glove-core's Agent uses, so text and voice turns read alike. */
export function resolvedInboxText(items: ReadonlyArray<InboxItem>): string {
  return `[Inbox: ${items.length} item(s) resolved]\n` +
    items.map((item) => `- [${item.tag}] Request: "${item.request}" -> Response: "${item.response}" (resolved ${item.resolved_at})`).join("\n");
}

export function pendingBlockingText(items: ReadonlyArray<InboxItem>): string {
  return `[Inbox: ${items.length} blocking item(s) still pending — you cannot proceed with actions that depend on these results]\n` +
    items.map((item) => `- [${item.tag}] ${item.request} (posted ${item.created_at})`).join("\n");
}
