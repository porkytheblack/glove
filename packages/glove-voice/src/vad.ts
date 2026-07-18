import EventEmitter from "eventemitter3";
import type { VADAdapter, VADAdapterEvents } from "./adapters/types";

export interface VADConfig {
  /**
   * Base RMS energy threshold to consider as speech (default: 0.01).
   * With `adaptive` on (the default), this is the floor — the effective
   * threshold rises above it in noisy environments.
   */
  threshold?: number;

  /** Trailing silence (ms) before `speech_end` fires (default: 1200). */
  silenceMs?: number;

  /**
   * Continuous speech (ms) required before `speech_start` fires — rejects
   * short noise bursts like keyboard clicks (default: 96).
   */
  minSpeechMs?: number;

  /**
   * Track the ambient noise floor and raise the effective threshold above
   * it (default: true). In a quiet room behavior is identical to a fixed
   * threshold; in a noisy one, steady background noise stops registering
   * as speech.
   */
  adaptive?: boolean;

  /** Effective threshold = max(threshold, noiseFloor × multiplier) (default: 3). */
  noiseFloorMultiplier?: number;

  /** Audio sample rate in Hz (default: 16000). Used to convert ms → samples. */
  sampleRate?: number;

  /**
   * @deprecated Legacy chunk-count option. Chunk duration depends on the
   * audio source (AudioWorklet emits 128-sample ≈ 8 ms chunks), so prefer
   * `silenceMs`. When set, it takes precedence over `silenceMs`.
   */
  silentFrames?: number;

  /**
   * @deprecated Legacy chunk-count option — prefer `minSpeechMs`.
   * When set, it takes precedence over `minSpeechMs`.
   */
  speechFrames?: number;
}

/**
 * Energy-based Voice Activity Detector with an adaptive noise floor.
 *
 * Zero-dependency and cheap — good for clean environments and as a
 * fallback. For real noise robustness use `SileroVADAdapter` from
 * `glove-voice/silero-vad` (neural, drop-in replacement): it distinguishes
 * speech from arbitrary noise rather than just loudness, and it supports
 * the tentative → confirmed speech lifecycle that lets GloveVoice gate STT
 * audio on *confirmed* speech.
 *
 * Timing is measured in audio samples, so behavior is independent of the
 * chunk size the audio source emits.
 */
export class VAD extends EventEmitter<VADAdapterEvents> implements VADAdapter {
  readonly supportsRealStart = false;

  private readonly baseThreshold: number;
  private readonly silenceSamples: number;
  private readonly minSpeechSamples: number;
  private readonly adaptive: boolean;
  private readonly noiseFloorMultiplier: number;

  // Legacy chunk-count mode (used only when the deprecated options are set)
  private readonly legacySilentFrames: number | null;
  private readonly legacySpeechFrames: number | null;

  private silentCount = 0;
  private speechCount = 0;
  private active = false;
  private noiseFloor: number | null = null;

  constructor(config: VADConfig = {}) {
    super();
    const sampleRate = config.sampleRate ?? 16_000;
    this.baseThreshold = config.threshold ?? 0.01;
    this.silenceSamples = Math.round(((config.silenceMs ?? 1200) / 1000) * sampleRate);
    this.minSpeechSamples = Math.round(((config.minSpeechMs ?? 96) / 1000) * sampleRate);
    this.adaptive = config.adaptive ?? true;
    this.noiseFloorMultiplier = config.noiseFloorMultiplier ?? 3;
    this.legacySilentFrames = config.silentFrames ?? null;
    this.legacySpeechFrames = config.speechFrames ?? null;
  }

  /**
   * Process a PCM chunk. Call this on every AudioCapture "chunk" event.
   */
  process(pcm: Int16Array): void {
    const rms = computeRMS(pcm);
    const threshold = this.effectiveThreshold();
    const isSpeech = rms > threshold;

    this.emit("speech_prob", Math.min(1, rms / (threshold * 2)));

    if (this.adaptive) this.updateNoiseFloor(rms, isSpeech);

    const speechUnit = this.legacySpeechFrames !== null ? 1 : pcm.length;
    const silentUnit = this.legacySilentFrames !== null ? 1 : pcm.length;
    const speechNeeded = this.legacySpeechFrames ?? this.minSpeechSamples;
    const silenceNeeded = this.legacySilentFrames ?? this.silenceSamples;

    if (isSpeech) {
      this.silentCount = 0;
      this.speechCount += speechUnit;

      if (!this.active && this.speechCount >= speechNeeded) {
        this.active = true;
        this.emit("speech_start");
      }
    } else {
      this.speechCount = 0;
      if (this.active) {
        this.silentCount += silentUnit;
        if (this.silentCount >= silenceNeeded) {
          this.active = false;
          this.silentCount = 0;
          this.emit("speech_end");
        }
      }
    }
  }

  /** Force reset — call when interrupting a turn */
  reset(): void {
    this.active = false;
    this.silentCount = 0;
    this.speechCount = 0;
  }

  get isSpeaking(): boolean {
    return this.active;
  }

  /** Current effective threshold (base or noise-floor-adapted). */
  get currentThreshold(): number {
    return this.effectiveThreshold();
  }

  // ─── Internals ─────────────────────────────────────────────────────────

  private effectiveThreshold(): number {
    if (!this.adaptive || this.noiseFloor === null) return this.baseThreshold;
    // Never adapt below the configured base, and cap so a burst of loud
    // noise can't push the threshold somewhere speech can never reach.
    return Math.min(
      Math.max(this.baseThreshold, this.noiseFloor * this.noiseFloorMultiplier),
      0.5,
    );
  }

  private updateNoiseFloor(rms: number, isSpeech: boolean): void {
    // Seed from the very first frame so an environment that is noisy from
    // the start is measured, not misread as continuous speech.
    if (this.noiseFloor === null) {
      this.noiseFloor = rms;
      return;
    }
    if (!isSpeech) {
      // Asymmetric EMA: adapt down quickly (room went quiet), up slowly
      // (don't let brief noise ratchet the threshold).
      const alpha = rms < this.noiseFloor ? 0.2 : 0.02;
      this.noiseFloor += (rms - this.noiseFloor) * alpha;
    } else {
      // Slow multiplicative creep while "speech" is detected, so sustained
      // noise that sits above the threshold is absorbed into the floor
      // within ~15s. Real speech pauses constantly, and every pause snaps
      // the floor back down via the branch above — so it never ratchets.
      this.noiseFloor = Math.min(this.noiseFloor * 1.001 + 1e-6, rms);
    }
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function computeRMS(pcm: Int16Array): number {
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) {
    const normalized = pcm[i] / 32768;
    sum += normalized * normalized;
  }
  return Math.sqrt(sum / pcm.length);
}
