export {
  useGloveVoice,
  type UseGloveVoiceConfig,
  type UseGloveVoiceReturn,
} from "./use-glove-voice";

// Re-export voice types for convenience so consumers don't need to import glove-voice directly
export type { VoiceMode, TurnMode, GloveVoiceConfig, TTSFactory } from "glove-voice";
export type { IGloveRunnable } from "glove-core/glove";
