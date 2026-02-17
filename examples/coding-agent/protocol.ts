import type { Task, ToolResult, ContentPart } from "glove-core";

// ─── Server → Client events ─────────────────────────────────────────────────

export interface TextDeltaEvent {
  type: "text_delta";
  data: { text: string };
}

export interface ToolUseEvent {
  type: "tool_use";
  data: { id: string; name: string; input: unknown };
}

export interface ToolUseResultEvent {
  type: "tool_use_result";
  data: ToolResult;
}

export interface SlotPushEvent {
  type: "slot_push";
  data: { id: string; renderer: string; input: unknown };
}

export interface SlotRemoveEvent {
  type: "slot_remove";
  data: { id: string };
}

export interface TasksUpdatedEvent {
  type: "tasks_updated";
  data: { tasks: Task[] };
}

export interface TurnCompleteEvent {
  type: "turn_complete";
  data: { tokens_in: number; tokens_out: number };
}

export interface RequestCompleteEvent {
  type: "request_complete";
  data: {};
}

export interface ErrorEvent {
  type: "error";
  data: { message: string };
}

export interface StateEvent {
  type: "state";
  data: {
    session_id: string;
    name: string;
    working_dir: string;
    tasks: Task[];
    stats: { turns: number; tokens_in: number; tokens_out: number };
    model?: string;
    features?: { planning: boolean; tasking: boolean; autoAccept: boolean };
  };
}

export interface ModelChangedEvent {
  type: "model_changed";
  data: { model: string };
}

export type HistoryTimelineEntry =
  | { kind: "user"; text: string; images?: string[] }
  | { kind: "agent_text"; text: string }
  | { kind: "tool"; id: string; name: string; input: unknown; status: "success" | "error"; output?: string };

export interface HistoryEvent {
  type: "history";
  data: { entries: HistoryTimelineEntry[] };
}

export type ServerEvent =
  | TextDeltaEvent
  | ToolUseEvent
  | ToolUseResultEvent
  | SlotPushEvent
  | SlotRemoveEvent
  | TasksUpdatedEvent
  | TurnCompleteEvent
  | RequestCompleteEvent
  | ErrorEvent
  | StateEvent
  | ModelChangedEvent
  | HistoryEvent;

// ─── Client → Server commands ────────────────────────────────────────────────

export interface UserRequestCommand {
  type: "user_request";
  data: { text: string; content?: ContentPart[] };
}

export interface SlotResolveCommand {
  type: "slot_resolve";
  data: { slot_id: string; value: unknown };
}

export interface SlotRejectCommand {
  type: "slot_reject";
  data: { slot_id: string };
}

export interface AbortCommand {
  type: "abort";
  data: {};
}

export interface ChangeModelCommand {
  type: "change_model";
  data: { provider: string; model?: string };
}

export type ClientCommand =
  | UserRequestCommand
  | SlotResolveCommand
  | SlotRejectCommand
  | AbortCommand
  | ChangeModelCommand;
