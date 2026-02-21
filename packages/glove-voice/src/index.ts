// Core
export { GloveVoice, type GloveVoiceConfig, type VoiceMode, type TurnMode, type TTSFactory } from "./voice";

// Adapters — contracts
export type {
  STTAdapter,
  STTAdapterEvents,
  TTSAdapter,
  TTSAdapterEvents,
  VADAdapter,
  VADAdapterEvents,
  GetTokenFn,
} from "./adapters/types";

// Adapters — ElevenLabs
export {
  createElevenLabsAdapters,
  type ElevenLabsAdaptersConfig,
  ElevenLabsSTTAdapter,
  type ElevenLabsSTTConfig,
  ElevenLabsTTSAdapter,
  type ElevenLabsTTSConfig,
} from "./adapters/eleven-labs";

// Built-in VAD (energy-based, zero dependencies)
export { VAD, type VADConfig } from "./vad";
// SileroVADAdapter is in "glove-voice/silero-vad" — separate entry to avoid
// pulling onnxruntime-web (browser-only WASM) into the main barrel.

// Errors
export { GloveVoiceError, type GloveVoiceErrorCode } from "./errors";

// Utilities
export { AudioCapture } from "./audio-capture";
export { AudioPlayer } from "./audio-player";
export { splitSentences, SentenceBuffer } from "./sentence-chunker";
export { extractText } from "./extract-text";
