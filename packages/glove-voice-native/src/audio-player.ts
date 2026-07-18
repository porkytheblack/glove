import { AudioContext } from "react-native-audio-api";
import type { AudioBufferSourceNode } from "react-native-audio-api";
import type { AudioPlayerAdapter } from "glove-voice";

/**
 * Low-latency streaming PCM player for React Native / Expo, backed by
 * `react-native-audio-api`'s Web Audio implementation.
 *
 * Direct port of glove-voice's browser `AudioPlayer`: chunks are scheduled
 * back-to-back on an AudioContext so TTS audio plays gaplessly as it
 * streams in.
 */
export class NativeAudioPlayer implements AudioPlayerAdapter {
  private context: AudioContext | null = null;
  private nextPlayTime = 0;
  private drainCallbacks: Array<() => void> = [];
  private activeBuffers = 0;
  private activeSources: Set<AudioBufferSourceNode> = new Set();
  private readonly sampleRate: number;

  constructor(sampleRate = 16_000) {
    this.sampleRate = sampleRate;
  }

  async init(): Promise<void> {
    this.context = new AudioContext({ sampleRate: this.sampleRate });
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
  }

  /**
   * Enqueue a raw PCM chunk (16-bit signed int, mono).
   * Starts playing immediately if idle, otherwise schedules after last chunk.
   */
  enqueue(pcm: Uint8Array): void {
    const context = this.context;
    if (!context) return;

    const int16 = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2);

    const audioBuffer = context.createBuffer(1, int16.length, this.sampleRate);
    const channel = audioBuffer.getChannelData(0);
    for (let i = 0; i < int16.length; i++) {
      channel[i] = int16[i] / (int16[i] < 0 ? 32768 : 32767);
    }

    const source = context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(context.destination);

    const now = context.currentTime;
    const startAt = Math.max(now, this.nextPlayTime);

    this.nextPlayTime = startAt + audioBuffer.duration;
    this.activeBuffers++;
    this.activeSources.add(source);

    source.onEnded = () => {
      this.activeBuffers--;
      this.activeSources.delete(source);
      if (this.activeBuffers === 0) {
        const cbs = this.drainCallbacks;
        this.drainCallbacks = [];
        for (const cb of cbs) cb();
      }
    };

    source.start(startAt);
  }

  /** Register a callback to fire once all queued audio has finished playing. */
  onDrained(cb: () => void): void {
    if (this.activeBuffers === 0) {
      cb();
    } else {
      this.drainCallbacks.push(cb);
    }
  }

  /** Immediately stop all audio. */
  stop(): void {
    if (!this.context) return;

    for (const source of this.activeSources) {
      try {
        source.onEnded = null;
        source.stop();
        source.disconnect();
      } catch {
        // Source may already be stopped or scheduled — ignore
      }
    }

    this.activeSources.clear();
    this.nextPlayTime = 0;
    this.activeBuffers = 0;
    this.drainCallbacks = [];
  }

  async destroy(): Promise<void> {
    this.stop();
    await this.context?.close();
    this.context = null;
  }
}
