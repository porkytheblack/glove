/**
 * Low-latency PCM audio player using Web Audio API.
 * Queues chunks and schedules them back-to-back to avoid gaps.
 */
export class AudioPlayer {
  private context: AudioContext | null = null;
  private nextPlayTime = 0;
  private drainCallbacks: Array<() => void> = [];
  private activeBuffers = 0;
  private readonly sampleRate: number;

  constructor(sampleRate = 16_000) {
    this.sampleRate = sampleRate;
  }

  async init(): Promise<void> {
    this.context = new AudioContext({ sampleRate: this.sampleRate });
  }

  /**
   * Enqueue a raw PCM chunk (16-bit signed int, mono).
   * Starts playing immediately if idle, otherwise schedules after last chunk.
   */
  enqueue(pcm: Uint8Array): void {
    if (!this.context) return;

    const int16 = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2);
    const audioBuffer = pcmToAudioBuffer(this.context, int16);

    const source = this.context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.context.destination);

    const now = this.context.currentTime;
    const startAt = Math.max(now, this.nextPlayTime);

    this.nextPlayTime = startAt + audioBuffer.duration;
    this.activeBuffers++;

    source.start(startAt);
    source.onended = () => {
      this.activeBuffers--;
      if (this.activeBuffers === 0) {
        const cbs = this.drainCallbacks;
        this.drainCallbacks = [];
        for (const cb of cbs) cb();
      }
    };
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
    // Suspend cancels all scheduled sources, resume readies the context for reuse.
    // We don't await — fire-and-forget is fine here because we reset all bookkeeping
    // synchronously, and any new enqueue() will schedule relative to currentTime.
    void this.context.suspend().then(() => this.context?.resume());
    this.nextPlayTime = 0;
    this.activeBuffers = 0;
    this.drainCallbacks = [];
  }

  async destroy(): Promise<void> {
    // Don't call stop() — just close the context directly. Closing an AudioContext
    // implicitly stops all processing and avoids the suspend/resume race.
    this.nextPlayTime = 0;
    this.activeBuffers = 0;
    this.drainCallbacks = [];
    await this.context?.close();
    this.context = null;
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function pcmToAudioBuffer(ctx: AudioContext, int16: Int16Array): AudioBuffer {
  const buffer = ctx.createBuffer(1, int16.length, ctx.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < int16.length; i++) {
    channel[i] = int16[i] / (int16[i] < 0 ? 32768 : 32767);
  }
  return buffer;
}
