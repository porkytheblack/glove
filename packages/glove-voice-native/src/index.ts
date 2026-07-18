// Audio IO — plug into GloveVoiceConfig.audio
export {
  createNativeAudioIO,
  withNativeAudio,
  type NativeAudioIOOptions,
} from "./audio-io";

// Individual adapters (for custom wiring)
export { NativeAudioCapture, type NativeAudioCaptureOptions } from "./audio-capture";
export { NativeAudioPlayer } from "./audio-player";

// SileroVADNativeAdapter is in "glove-voice-native/silero-vad" — separate
// entry so importing the audio IO never touches onnxruntime-react-native.

// Re-export the contracts consumers implement against
export type {
  AudioIO,
  AudioCaptureAdapter,
  AudioCaptureAdapterEvents,
  AudioPlayerAdapter,
  VADAdapter,
  VADAdapterEvents,
} from "glove-voice";
