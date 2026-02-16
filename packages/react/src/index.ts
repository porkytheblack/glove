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
  GloveState,
  GloveStats,
  ToolConfig,
  CompactionConfig,
  SlotRenderProps,
  ToolDisplay,
  Task,
  ContentPart,
  Slot,
  StoreAdapter,
  ModelAdapter,
  SubscriberAdapter,
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
