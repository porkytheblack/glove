import type { Task, ContentPart, SubscriberAdapter, StoreAdapter, ModelAdapter } from "@glove/core/core";
import type { Slot } from "@glove/core/display-manager";
import type z from "zod";
import type { ReactNode } from "react";

export type { Task, ContentPart, Slot, SubscriberAdapter, StoreAdapter, ModelAdapter };

// ─── Timeline ────────────────────────────────────────────────────────────────

export type TimelineEntry =
  | { kind: "user"; text: string; images?: string[] }
  | { kind: "agent_text"; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      input: unknown;
      status: "running" | "success" | "error";
      output?: string;
    };

// ─── Agent state ─────────────────────────────────────────────────────────────

export interface GloveStats {
  turns: number;
  tokens_in: number;
  tokens_out: number;
}

export interface GloveState {
  busy: boolean;
  timeline: TimelineEntry[];
  streamingText: string;
  tasks: Task[];
  slots: Slot<unknown>[];
  stats: GloveStats;
}

// ─── Slot rendering ──────────────────────────────────────────────────────────

export interface SlotRenderProps<T = any> {
  data: T;
  resolve: (value: unknown) => void;
}

// ─── Tool display adapter ────────────────────────────────────────────────────

/** Display adapter passed to `ToolConfig.do()`. When the tool has a colocated
 *  `render`, the `renderer` field is auto-filled by the framework — so you only
 *  need to pass `{ input }`. For tools without `render`, pass `renderer` explicitly. */
export interface ToolDisplay {
  pushAndWait: <I, O = unknown>(slot: { renderer?: string; input: I }) => Promise<O>;
  pushAndForget: <I>(slot: { renderer?: string; input: I }) => Promise<string>;
}

// ─── Tool config (structurally matches GloveFoldArgs from core) ──────────────

export interface ToolConfig<I = any> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  requiresPermission?: boolean;
  do: (input: I, display: ToolDisplay) => Promise<unknown>;
  /** Colocated renderer for this tool's display slots. When present, the tool
   *  name is auto-used as the slot renderer key — no need to pass `renderer`
   *  in `display.pushAndWait()` / `display.pushAndForget()`. */
  render?: (props: SlotRenderProps) => ReactNode;
}

// ─── Compaction config (structurally matches CompactionConfig from core) ─────

export interface CompactionConfig {
  max_turns?: number;
  compaction_instructions: string;
  compaction_context_limit?: number;
}
