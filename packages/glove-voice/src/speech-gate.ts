// ─── SpeechGate ────────────────────────────────────────────────────────────
//
// Gates the mic → STT audio path so the STT provider only ever receives
// audio for confirmed speech segments (plus a short pre-roll), instead of a
// continuous stream of everything the microphone hears.
//
// Why: streaming raw mic audio 24/7 into an STT provider means background
// noise — keyboards, traffic, music, other people — is constantly being
// transcribed (or hallucinated into words). Gating on the VAD's confirmed
// speech signal means noise never reaches the provider at all, which is both
// more accurate and cheaper than trying to filter transcripts after the fact.
//
// State machine:
//
//   closed ──speech tentative──▶ pending ──speech confirmed──▶ open
//     ▲                            │                             │
//     │◀────────misfire────────────┘                             │
//     │◀───────────────────speech ended──────────────────────────┘
//
// - closed:  keep a rolling pre-roll window of recent audio, forward nothing.
// - pending: a VAD with a tentative phase (Silero) reported possible speech.
//            Keep buffering — if it's a misfire the audio is silently dropped
//            and the STT provider never sees it.
// - open:    speech confirmed. The buffered pre-roll + tentative audio is
//            flushed to STT in one burst, then live chunks stream through.

export interface SpeechGateOptions {
  /** Audio sample rate in Hz (default: 16000). */
  sampleRate?: number;
  /**
   * Rolling window of audio (ms) kept while the gate is closed and flushed
   * to STT when a speech segment opens, so the first syllable isn't clipped
   * (default: 800 — matches Silero's preSpeechPadMs default).
   */
  prerollMs?: number;
  /**
   * Fail-open cap (ms) on the pending state. If a VAD reports tentative
   * speech but never confirms or misfires, the gate opens anyway once this
   * much audio has accumulated, so real speech is never lost (default: 5000).
   */
  maxPendingMs?: number;
}

type GateState = "closed" | "pending" | "open";

export class SpeechGate {
  private state: GateState = "closed";
  private buffer: Int16Array[] = [];
  private bufferedSamples = 0;
  private readonly prerollSamples: number;
  private readonly maxPendingSamples: number;

  constructor(opts: SpeechGateOptions = {}) {
    const sampleRate = opts.sampleRate ?? 16_000;
    this.prerollSamples = Math.round(((opts.prerollMs ?? 800) / 1000) * sampleRate);
    this.maxPendingSamples = Math.round(((opts.maxPendingMs ?? 5000) / 1000) * sampleRate);
  }

  /**
   * Feed a mic chunk. Returns the chunks that should be forwarded to STT
   * right now — the chunk itself when the gate is open, nothing otherwise.
   */
  feed(pcm: Int16Array): Int16Array[] {
    if (this.state === "open") return [pcm];

    this.buffer.push(pcm);
    this.bufferedSamples += pcm.length;

    if (this.state === "closed") {
      this.trimTo(this.prerollSamples);
      return [];
    }

    // pending — fail open if confirmation never arrives
    if (this.bufferedSamples >= this.maxPendingSamples) return this.open();
    return [];
  }

  /**
   * Tentative speech detected (e.g. Silero `speech_start` before the
   * minimum-duration filter). Audio keeps buffering until `open()` confirms
   * or `cancel()` discards.
   */
  hold(): void {
    if (this.state === "closed") this.state = "pending";
  }

  /**
   * Speech confirmed — open the gate. Returns the buffered pre-roll +
   * tentative audio, which should be flushed to STT before live streaming.
   */
  open(): Int16Array[] {
    this.state = "open";
    const out = this.buffer;
    this.buffer = [];
    this.bufferedSamples = 0;
    return out;
  }

  /**
   * The tentative speech was a misfire (too short / noise burst). Drop the
   * buffered audio beyond the pre-roll window — STT never sees it.
   */
  cancel(): void {
    if (this.state === "open") return; // confirmed segments end via close()
    this.state = "closed";
    this.trimTo(this.prerollSamples);
  }

  /** Utterance finished — close the gate. Pre-roll starts accumulating again. */
  close(): void {
    this.state = "closed";
    this.buffer = [];
    this.bufferedSamples = 0;
  }

  /** Force reset — call when interrupting a turn. */
  reset(): void {
    this.close();
  }

  get isOpen(): boolean {
    return this.state === "open";
  }

  get isPending(): boolean {
    return this.state === "pending";
  }

  private trimTo(maxSamples: number): void {
    while (
      this.buffer.length > 1 &&
      this.bufferedSamples - this.buffer[0].length >= maxSamples
    ) {
      this.bufferedSamples -= this.buffer[0].length;
      this.buffer.shift();
    }
  }
}
