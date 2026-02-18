// ─── Adapters (no React dependency — RSC-safe) ──────────────────────────────

export { MemoryStore } from "./adapters/memory-store";
export {
  createRemoteStore,
  type RemoteStoreActions,
} from "./adapters/remote-store";
export {
  createRemoteModel,
  type RemoteModelActions,
  type RemotePromptRequest,
  type RemotePromptResponse,
  type RemoteStreamEvent,
  type SerializedTool,
} from "./adapters/remote-model";
export { createEndpointModel } from "./adapters/endpoint-model";
export { parseSSEStream } from "./sse";

// ─── Types ───────────────────────────────────────────────────────────────────

export type {
  TimelineEntry,
  ToolEntry,
  GloveState,
  GloveStats,
  ToolConfig,
  CompactionConfig,
  SlotRenderProps,
  ToolResultRenderProps,
  ToolDisplay,
  TypedDisplay,
  Task,
  ContentPart,
  Slot,
  ToolResultData,
  StoreAdapter,
  ModelAdapter,
  SubscriberAdapter,
  EnhancedSlot,
  SlotDisplayStrategy,
  RenderStrategy,
  MessageRenderProps,
  ToolStatusRenderProps,
  StreamingRenderProps,
  InputRenderProps,
  SlotContainerRenderProps,
  GloveHandle,
} from "./types";

// ─── Client ─────────────────────────────────────────────────────────────────

export { GloveClient, type GloveClientConfig } from "./client";

// ─── Hooks (client-only) ────────────────────────────────────────────────────

export {
  useGlove,
  type UseGloveConfig,
  type UseGloveReturn,
} from "./hooks/use-glove";
export { GloveProvider, useGloveClient } from "./hooks/context";

// ─── Render ──────────────────────────────────────────────────────────────────

export { Render, type RenderProps } from "./render";

// ─── Helpers ─────────────────────────────────────────────────────────────────

export { defineTool } from "./define-tool";
