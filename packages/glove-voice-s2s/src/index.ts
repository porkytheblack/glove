// Session — a realtime voice session driven by a Glove agent.
export {
  GloveS2S,
  type GloveS2SConfig,
  type GloveS2SEvents,
  type S2SState,
  type TranscriptSink,
} from "./glove-s2s";

// Tool hosts — where the model's tool calls actually run.
export {
  gloveToolHost,
  delegateToolHost,
  localToolHost,
  httpToolHost,
  composeToolHosts,
  type S2SToolHost,
  type S2SCallOptions,
  type GloveToolHostOptions,
  type DelegateToolHostOptions,
  type LocalS2STool,
  type HttpToolHostOptions,
} from "./tool-host";

// Providers.
export { OpenAIRealtimeAdapter, type OpenAIRealtimeConfig } from "./openai-realtime";

// Contracts.
export type { S2SAdapter, S2SEvents, S2SSessionConfig, S2STool } from "./types";
