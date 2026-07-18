import type { AudioIO, GloveVoiceConfig } from "glove-voice";
import { NativeAudioCapture, type NativeAudioCaptureOptions } from "./audio-capture";
import { NativeAudioPlayer } from "./audio-player";

export interface NativeAudioIOOptions extends NativeAudioCaptureOptions {}

/**
 * Build the platform `AudioIO` for React Native / Expo. Pass it as
 * `audio` in `GloveVoiceConfig` — everything else in the pipeline (VAD,
 * speech gating, STT/TTS adapters, barge-in, narrate) is platform-neutral
 * and runs unchanged.
 *
 * ```ts
 * import { useGloveVoice } from "glove-react/voice";
 * import { createNativeAudioIO } from "glove-voice-native";
 *
 * const voice = useGloveVoice({
 *   runnable,
 *   voice: { stt, createTTS, vad, audio: createNativeAudioIO() },
 * });
 * ```
 */
export function createNativeAudioIO(options: NativeAudioIOOptions = {}): AudioIO {
  return {
    createCapture: (sampleRate: number) => new NativeAudioCapture(sampleRate, options),
    createPlayer: (sampleRate: number) => new NativeAudioPlayer(sampleRate),
  };
}

/**
 * Convenience wrapper: returns the voice config with native audio IO
 * attached.
 *
 * ```ts
 * const voice = useGloveVoice({
 *   runnable,
 *   voice: withNativeAudio({ stt, createTTS, vad }),
 * });
 * ```
 */
export function withNativeAudio(
  config: Omit<GloveVoiceConfig, "audio">,
  options: NativeAudioIOOptions = {},
): GloveVoiceConfig {
  return { ...config, audio: createNativeAudioIO(options) };
}
