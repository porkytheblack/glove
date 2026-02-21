import type { Task, ContentPart, SubscriberAdapter, StoreAdapter, ModelAdapter, ToolResultData } from "glove-core/core";
import type { Slot } from "glove-core/display-manager";
import type { IGloveRunnable } from "glove-core/glove";
import type z from "zod";
import type { ReactNode } from "react";

export type { Task, ContentPart, Slot, SubscriberAdapter, StoreAdapter, ModelAdapter, ToolResultData, IGloveRunnable };

// ─── Timeline ────────────────────────────────────────────────────────────────

export type TimelineEntry =
  | { kind: "user"; text: string; images?: string[] }
  | { kind: "agent_text"; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      input: unknown;
      status: "running" | "success" | "error" | "aborted";
      output?: string;
      renderData?: unknown;
    };

export type ToolEntry = Extract<TimelineEntry, { kind: "tool" }>;

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
  slots: EnhancedSlot[];
  stats: GloveStats;
}

// ─── Slot rendering ──────────────────────────────────────────────────────────

export interface SlotRenderProps<T = any> {
  data: T;
  resolve: (value: unknown) => void;
  reject: (reason?: string) => void;
}

export interface ToolResultRenderProps<T = any> {
  data: T;
  output?: string;
  status: "success" | "error" | "aborted";
}

// ─── Enhanced slots ──────────────────────────────────────────────────────────

export type SlotDisplayStrategy = "stay" | "hide-on-complete" | "hide-on-new";

export interface EnhancedSlot extends Slot<unknown> {
  toolName: string;
  toolCallId: string;
  createdAt: number;
  displayStrategy: SlotDisplayStrategy;
  status: "pending" | "resolved" | "rejected";
}

// ─── Render types ────────────────────────────────────────────────────────────

export type RenderStrategy = "interleaved" | "slots-before" | "slots-after" | "slots-only";

export interface MessageRenderProps {
  entry: Extract<TimelineEntry, { kind: "user" | "agent_text" }>;
  index: number;
  isLast: boolean;
}

export interface ToolStatusRenderProps {
  entry: ToolEntry;
  index: number;
  hasSlot: boolean;
}

export interface StreamingRenderProps {
  text: string;
}

export interface InputRenderProps {
  send: (text: string, images?: { data: string; media_type: string }[]) => void;
  busy: boolean;
  abort: () => void;
}

export interface SlotContainerRenderProps {
  slots: EnhancedSlot[];
  renderSlot: (slot: EnhancedSlot) => ReactNode;
}

export interface GloveHandle {
  timeline: TimelineEntry[];
  streamingText: string;
  busy: boolean;
  slots: EnhancedSlot[];
  sendMessage: (text: string, images?: { data: string; media_type: string }[]) => void;
  abort: () => void;
  renderSlot: (slot: EnhancedSlot) => ReactNode;
  renderToolResult: (entry: ToolEntry) => ReactNode;
  resolveSlot: (slotId: string, value: unknown) => void;
  rejectSlot: (slotId: string, reason?: string) => void;
}

// ─── Tool display adapter ────────────────────────────────────────────────────

/** Display adapter passed to `ToolConfig.do()`. When the tool has a colocated
 *  `render`, the `renderer` field is auto-filled by the framework — so you only
 *  need to pass `{ input }`. For tools without `render`, pass `renderer` explicitly. */
export interface ToolDisplay {
  pushAndWait: <I, O = unknown>(slot: { renderer?: string; input: I }) => Promise<O>;
  pushAndForget: <I>(slot: { renderer?: string; input: I }) => Promise<string>;
}

/** Typed display for `defineTool` — eliminates `renderer` and provides full
 *  type safety on the display/resolve schemas. */
export interface TypedDisplay<D, R = void> {
  pushAndWait: (input: D) => Promise<R>;
  pushAndForget: (input: D) => Promise<string>;
}

// ─── Tool config (structurally matches GloveFoldArgs from core) ──────────────

export interface ToolConfig<I = any> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  requiresPermission?: boolean;
  unAbortable?: boolean;
  displayStrategy?: SlotDisplayStrategy;
  do: (input: I, display: ToolDisplay) => Promise<ToolResultData>;
  /** Colocated renderer for this tool's display slots. When present, the tool
   *  name is auto-used as the slot renderer key — no need to pass `renderer`
   *  in `display.pushAndWait()` / `display.pushAndForget()`. */
  render?: (props: SlotRenderProps) => ReactNode;
  /** Secondary renderer for showing tool results from history (e.g. after reload).
   *  Receives the `renderData` from the tool result — use this to show a read-only
   *  view of what the user submitted via pushAndWait. */
  renderResult?: (props: ToolResultRenderProps) => ReactNode;
}

// ─── Compaction config (structurally matches CompactionConfig from core) ─────

export interface CompactionConfig {
  max_turns?: number;
  compaction_instructions: string;
  compaction_context_limit?: number;
}
