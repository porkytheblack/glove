import EventEmitter from "eventemitter3";
import type { VADAdapter, VADAdapterEvents } from "./adapters/types";

export interface VADConfig {
  /** RMS energy threshold to consider as speech (default: 0.01) */
  threshold?: number;
  /** Consecutive silent frames before speechEnd fires (default: 15 ~= 600ms at 16kHz/2048) */
  silentFrames?: number;
  /** Consecutive speech frames before speechStart fires, avoids false triggers (default: 3) */
  speechFrames?: number;
}

/**
 * Energy-based Voice Activity Detector.
 *
 * Simple but effective for clean mic environments. For noisy environments
 * or higher accuracy, swap this with Silero VAD (WASM, ~50ms inference).
 * The interface is identical so it's a drop-in replacement.
 *
 * @see https://github.com/snakers4/silero-vad for the upgrade path
 */
export class VAD extends EventEmitter<VADAdapterEvents> implements VADAdapter {
  private readonly threshold: number;
  private readonly silentFramesNeeded: number;
  private readonly speechFramesNeeded: number;

  private silentFrameCount = 0;
  private speechFrameCount = 0;
  private active = false;

  constructor(config: VADConfig = {}) {
    super();
    this.threshold = config.threshold ?? 0.01;
    this.silentFramesNeeded = config.silentFrames ?? 15;
    this.speechFramesNeeded = config.speechFrames ?? 3;
  }

  /**
   * Process a PCM frame. Call this on every AudioCapture "chunk" event.
   */
  process(pcm: Int16Array): void {
    const rms = computeRMS(pcm);

    if (rms > this.threshold) {
      // Speech energy detected
      this.silentFrameCount = 0;
      this.speechFrameCount++;

      if (!this.active && this.speechFrameCount >= this.speechFramesNeeded) {
        this.active = true;
        this.emit("speech_start");
      }
    } else {
      // Silence
      this.speechFrameCount = 0;
      if (this.active) {
        this.silentFrameCount++;
        if (this.silentFrameCount >= this.silentFramesNeeded) {
          this.active = false;
          this.silentFrameCount = 0;
          this.emit("speech_end");
        }
      }
    }
  }

  /** Force reset — call when interrupting a turn */
  reset(): void {
    this.active = false;
    this.silentFrameCount = 0;
    this.speechFrameCount = 0;
  }

  get isSpeaking(): boolean {
    return this.active;
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