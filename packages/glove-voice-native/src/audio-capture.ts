import EventEmitter from "eventemitter3";
import { AudioRecorder, AudioManager } from "react-native-audio-api";
import type { IOSCategory, IOSMode, IOSOption } from "react-native-audio-api";
import { GloveVoiceError } from "glove-voice";
import type { AudioCaptureAdapter, AudioCaptureAdapterEvents } from "glove-voice";

export interface NativeAudioCaptureOptions {
  /**
   * Preferred duration of each mic chunk in ms (default: 50). Smaller
   * chunks lower STT/VAD latency at slightly higher CPU cost. The OS may
   * deliver slightly different sizes — the Glove pipeline is chunk-size
   * independent, so that's fine.
   */
  bufferLengthMs?: number;

  /**
   * Request mic permission inside `init()` (default: true). Set to false
   * if your app runs its own permission flow beforehand.
   */
  requestPermissions?: boolean;

  /**
   * Configure + activate the shared audio session in `init()` and
   * deactivate it in `destroy()` (default: true). Set to false when your
   * app manages `AudioManager` itself.
   */
  manageAudioSession?: boolean;

  /** iOS audio session category (default: "playAndRecord" — full duplex). */
  iosCategory?: IOSCategory;

  /**
   * iOS audio session mode (default: "voiceChat"). voiceChat enables the
   * OS voice-processing chain — echo cancellation + gain control — which
   * is what keeps the agent's own TTS out of the mic on speakerphone.
   */
  iosMode?: IOSMode;

  /** iOS session options (default: ["defaultToSpeaker", "allowBluetoothHFP"]). */
  iosOptions?: IOSOption[];
}

/**
 * On-device microphone capture for React Native / Expo, backed by
 * `react-native-audio-api`'s `AudioRecorder`.
 *
 * Emits the same `chunk` events (Int16 mono PCM at the pipeline sample
 * rate) as the browser `AudioCapture`, so the whole Glove voice pipeline —
 * VAD, speech gating, STT/TTS adapters, barge-in — runs unchanged.
 *
 * Requires a dev client / prebuild (not Expo Go): `react-native-audio-api`
 * is a native module. See the glove-voice-native README for the Expo
 * config-plugin setup.
 */
export class NativeAudioCapture
  extends EventEmitter<AudioCaptureAdapterEvents>
  implements AudioCaptureAdapter
{
  private recorder: AudioRecorder | null = null;
  private sessionActivated = false;
  private readonly sampleRate: number;
  private readonly opts: Required<
    Pick<NativeAudioCaptureOptions, "bufferLengthMs" | "requestPermissions" | "manageAudioSession">
  > &
    NativeAudioCaptureOptions;

  constructor(sampleRate = 16_000, options: NativeAudioCaptureOptions = {}) {
    super();
    this.sampleRate = sampleRate;
    this.opts = {
      bufferLengthMs: options.bufferLengthMs ?? 50,
      requestPermissions: options.requestPermissions ?? true,
      manageAudioSession: options.manageAudioSession ?? true,
      ...options,
    };
  }

  async init(): Promise<void> {
    if (this.opts.requestPermissions) {
      const status = await AudioManager.requestRecordingPermissions();
      if (status !== "Granted") {
        throw new GloveVoiceError(
          "ERR_MIC_DENIED",
          "Microphone permission was not granted. GloveVoice requires microphone access to capture audio.",
        );
      }
    }

    if (this.opts.manageAudioSession) {
      AudioManager.setAudioSessionOptions({
        iosCategory: this.opts.iosCategory ?? "playAndRecord",
        iosMode: this.opts.iosMode ?? "voiceChat",
        iosOptions: this.opts.iosOptions ?? ["defaultToSpeaker", "allowBluetoothHFP"],
      });
      await AudioManager.setAudioSessionActivity(true);
      this.sessionActivated = true;
    }

    const recorder = new AudioRecorder();
    this.recorder = recorder;

    recorder.onError((error) => {
      const message =
        (error as { message?: string })?.message ?? "Native audio recorder error";
      this.emit("error", new GloveVoiceError("ERR_MIC_UNAVAILABLE", message));
    });

    const bufferLength = Math.max(
      1,
      Math.round((this.opts.bufferLengthMs / 1000) * this.sampleRate),
    );

    recorder.onAudioReady(
      { sampleRate: this.sampleRate, bufferLength, channelCount: 1 },
      (event) => {
        try {
          const float32 = event.buffer.getChannelData(0);
          const frames = Math.min(event.numFrames ?? float32.length, float32.length);
          const int16 = new Int16Array(frames);
          for (let i = 0; i < frames; i++) {
            const clamped = Math.max(-1, Math.min(1, float32[i]));
            int16[i] = clamped < 0 ? clamped * 32768 : clamped * 32767;
          }
          this.emit("chunk", int16);
        } catch (err) {
          this.emit("error", err instanceof Error ? err : new Error(String(err)));
        }
      },
    );

    const result = await recorder.start();
    if (result.status === "error") {
      throw new GloveVoiceError(
        "ERR_MIC_UNAVAILABLE",
        `Failed to start native audio recorder: ${result.message}`,
      );
    }
  }

  async destroy(): Promise<void> {
    const recorder = this.recorder;
    this.recorder = null;

    if (recorder) {
      try {
        recorder.clearOnAudioReady();
        recorder.clearOnError();
        await recorder.stop();
      } catch {
        // Recorder may never have started — releasing is best-effort.
      }
    }

    if (this.sessionActivated) {
      this.sessionActivated = false;
      await AudioManager.setAudioSessionActivity(false).catch(() => {});
    }
  }
}
