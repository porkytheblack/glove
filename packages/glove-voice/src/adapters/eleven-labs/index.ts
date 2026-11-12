import type { GetTokenFn } from "../types";
import { ElevenLabsSTTAdapter, type ElevenLabsSTTConfig } from "./stt";
import { ElevenLabsTTSAdapter, type ElevenLabsTTSConfig } from "./tts";
import type { TTSFactory } from "../../voice";

export {
  ElevenLabsSTTAdapter,
  type ElevenLabsSTTConfig,
  type ElevenLabsSTTEvents,
  type ElevenLabsRealtimeModel,
  type ElevenLabsCommitStrategy,
  type ScribeWord,
  type ScribeCommit,
  type ScribeDiarizedSegment,
  type ScribeSpeakerTurn,
} from "./stt";
export { ElevenLabsTTSAdapter, type ElevenLabsTTSConfig } from "./tts";
export { createElevenLabsSTTToken, createElevenLabsTTSToken } from "./server";

export interface ElevenLabsAdaptersConfig {
  /** Token fetcher for STT (Scribe v3 Live) */
  getSTTToken: GetTokenFn;
  /** Token fetcher for TTS (Input Streaming) */
  getTTSToken: GetTokenFn;
  /** ElevenLabs voice ID */
  voiceId: string;
  /** Override STT options */
  stt?: Omit<ElevenLabsSTTConfig, "getToken">;
  /** Override TTS options */
  tts?: Omit<ElevenLabsTTSConfig, "getToken" | "voiceId">;
}

/**
 * Convenience factory that creates an STT adapter and a TTS factory
 * for use with GloveVoice.
 *
 * @example
 * const { stt, createTTS } = createElevenLabsAdapters({
 *   getSTTToken: () => fetch("/api/voice/stt-token").then(r => r.json()).then(d => d.token),
 *   getTTSToken: () => fetch("/api/voice/tts-token").then(r => r.json()).then(d => d.token),
 *   voiceId: "JBFqnCBsd6RMkjVDRZzb",
 * });
 *
 * const voice = new GloveVoice(glove, { stt, createTTS });
 */
export function createElevenLabsAdapters(config: ElevenLabsAdaptersConfig): {
  stt: ElevenLabsSTTAdapter;
  createTTS: TTSFactory;
} {
  const stt = new ElevenLabsSTTAdapter({
    getToken: config.getSTTToken,
    ...config.stt,
  });

  const createTTS: TTSFactory = () =>
    new ElevenLabsTTSAdapter({
      getToken: config.getTTSToken,
      voiceId: config.voiceId,
      ...config.tts,
    });

  return { stt, createTTS };
}
