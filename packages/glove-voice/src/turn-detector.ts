// ─────────────────────────────────────────────────────────────────────────────
// Turn detection (semantic endpointing)
//
// A VAD knows when AUDIO stopped; it cannot know whether the SPEAKER is done.
// Production voice stacks solve this with a dedicated turn-detection layer
// that runs at each VAD end-of-speech boundary and decides how much longer to
// wait before committing the utterance:
//
//   - LiveKit's turn-detector: an open-weights transformer that scores the
//     live transcript for end-of-utterance probability and dynamically
//     EXTENDS the silence timeout when the text looks unfinished.
//   - Pipecat's smart-turn: an audio-native model reading prosody and
//     intonation instead of (or alongside) the transcript.
//   - AssemblyAI Universal-Streaming: semantic endpointing fused into the
//     STT itself.
//
// GloveVoice mirrors that architecture with `TurnDetectorAdapter`: a small
// contract consumed at each VAD boundary, so heuristics and model-backed
// detectors are interchangeable — the same pattern as `VADAdapter`
// (energy VAD ↔ Silero) and the STT/TTS adapters.
//
// `HeuristicTurnDetector` is the zero-dependency baseline: tiered holds
// weighted by how much the transcript's ending can be TRUSTED as a finished
// turn. A model-backed adapter (e.g. an ONNX end-of-utterance scorer, loaded
// like `SileroVADAdapter`) plugs into the same interface by mapping
// P(end-of-turn) to a hold.
// ─────────────────────────────────────────────────────────────────────────────

/** The decision for one VAD end-of-speech boundary. */
export interface TurnDecision {
  /**
   * How much LONGER to wait (ms) beyond the VAD boundary before committing
   * the utterance. `0` = the speaker is done, commit now. Any hold should be
   * cancelled if the speaker resumes — the utterance continues.
   */
  holdMs: number;
  /** Why — a short machine-friendly label for metrics and tuning. */
  reason: string;
}

/**
 * Decides, at a VAD end-of-speech boundary, whether the speaker is actually
 * done. Implementations may be pure heuristics (see `HeuristicTurnDetector`)
 * or model-backed (an end-of-utterance scorer); `decide` may be async to
 * allow inference, but should resolve in a few ms — it sits directly on the
 * voice hot path.
 */
/** Recent conversation turns, oldest first — context sharpens model-backed
 *  detectors considerably ("My engine." is complete alone, but clearly
 *  unfinished right after the agent asked "what do you need?"). */
export interface TurnContextMessage {
  role: "user" | "assistant";
  content: string;
}

export interface TurnDetectorAdapter {
  decide(
    transcript: string,
    context?: TurnContextMessage[],
  ): TurnDecision | Promise<TurnDecision>;
}

export interface HeuristicTurnDetectorConfig {
  /** Hold after `?`/`!` endings — a question aimed at the agent is done the
   *  moment it's asked (default 0). */
  questionHoldMs?: number;
  /**
   * Hold after `.`/`…` endings (default 600). Streaming STT providers
   * auto-punctuate their partials, so a trailing period is only WEAK evidence
   * the speaker finished — lazy-paced fragments arrive period-terminated.
   */
  statementHoldMs?: number;
  /** Hold when the transcript ends mid-thought — no terminal punctuation,
   *  trailing comma/conjunction (default 900). */
  unfinishedHoldMs?: number;
  /**
   * Hold when the speaker appears to be SPELLING something out — the
   * transcript ends in a 1–2 character token ("K", "0-0-7"). Letter-by-letter
   * dictation has inter-character gaps far longer than conversational pauses,
   * and chopping an identifier into fragments is worse than any latency
   * (default 2000). Overrides the punctuation tiers.
   */
  dictationHoldMs?: number;
}

/**
 * Zero-dependency semantic endpointing over the live transcript.
 *
 * Tiers, checked in order:
 *   1. dictation  — ends in a 1–2 char token → `dictationHoldMs`
 *   2. question   — ends `?`/`!`             → `questionHoldMs` (commit now)
 *   3. statement  — ends `.`/`…`             → `statementHoldMs`
 *   4. unfinished — anything else            → `unfinishedHoldMs`
 *
 * The caller owns the mechanics: arm a timer for `holdMs`, cancel it if the
 * speaker resumes, commit when it fires.
 */
export class HeuristicTurnDetector implements TurnDetectorAdapter {
  private readonly questionHoldMs: number;
  private readonly statementHoldMs: number;
  private readonly unfinishedHoldMs: number;
  private readonly dictationHoldMs: number;

  constructor(config: HeuristicTurnDetectorConfig = {}) {
    this.questionHoldMs = config.questionHoldMs ?? 0;
    this.statementHoldMs = config.statementHoldMs ?? 600;
    this.unfinishedHoldMs = config.unfinishedHoldMs ?? 900;
    this.dictationHoldMs = config.dictationHoldMs ?? 2000;
  }

  decide(transcript: string): TurnDecision {
    const s = transcript.trim();
    if (!s) return { holdMs: 0, reason: "empty" };

    // Dictation first — it overrides punctuation ("0-0-7." carries an
    // STT-guessed period, but the speaker is mid-identifier).
    const tokens = s
      .replace(/[.…?!,]+["')\]]*\s*$/, "")
      .trim()
      .split(/[\s\-–—]+/)
      .filter(Boolean);
    const last = tokens[tokens.length - 1] ?? "";
    if (/^[a-z0-9]{1,2}$/i.test(last)) {
      return { holdMs: this.dictationHoldMs, reason: "dictation" };
    }

    if (/[?!][\s"')\]]*$/.test(s)) return { holdMs: this.questionHoldMs, reason: "question" };
    if (/[.…][\s"')\]]*$/.test(s)) return { holdMs: this.statementHoldMs, reason: "statement" };
    return { holdMs: this.unfinishedHoldMs, reason: "unfinished" };
  }
}

export interface RemoteTurnDetectorConfig {
  /** Endpoint POSTed `{ transcript }`; must return `{ probability }` in [0,1]
   *  (e.g. a route backed by `LiveKitEouScorer` from `glove-voice/server`). */
  url: string;
  /** P(end-of-utterance) at or above which the turn commits immediately
   *  (default 0.5). */
  threshold?: number;
  /** Detector used when the endpoint is slow/unreachable, and to pick the
   *  hold when the model says "not done" (default: HeuristicTurnDetector). */
  fallback?: TurnDetectorAdapter;
  /** Abort the scoring request after this long and use the fallback
   *  (default 350ms — the detector sits on the voice hot path). */
  timeoutMs?: number;
}

/**
 * Model-backed turn detection over HTTP — the LiveKit deployment shape: the
 * end-of-utterance model runs server-side (see `LiveKitEouScorer` in
 * `glove-voice/server`), the client calls a scoring endpoint at each VAD
 * boundary.
 *
 *   P >= threshold  → commit now (holdMs 0)
 *   P <  threshold  → the model says "not done"; hold for whatever the
 *                     fallback heuristic picks (its dictation/unfinished
 *                     tiers still apply), never less than 300ms.
 *   error / timeout → fallback decides alone.
 */
export class RemoteTurnDetector implements TurnDetectorAdapter {
  private readonly url: string;
  private readonly threshold: number;
  private readonly fallback: TurnDetectorAdapter;
  private readonly timeoutMs: number;

  constructor(config: RemoteTurnDetectorConfig) {
    this.url = config.url;
    this.threshold = config.threshold ?? 0.5;
    this.fallback = config.fallback ?? new HeuristicTurnDetector();
    this.timeoutMs = config.timeoutMs ?? 350;
  }

  async decide(transcript: string, context?: TurnContextMessage[]): Promise<TurnDecision> {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      const res = await fetch(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript, context }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`scorer ${res.status}`);
      const { probability } = (await res.json()) as { probability: number };
      const p = Number(probability);
      if (!Number.isFinite(p)) throw new Error("scorer returned no probability");
      if (p >= this.threshold) return { holdMs: 0, reason: `eou:${p.toFixed(2)}` };
      const fb = await this.fallback.decide(transcript);
      return {
        holdMs: Math.max(fb.holdMs, 300),
        reason: `eou-low:${p.toFixed(2)}:${fb.reason}`,
      };
    } catch {
      const fb = await this.fallback.decide(transcript);
      return { holdMs: fb.holdMs, reason: `fallback:${fb.reason}` };
    }
  }
}
