// ─────────────────────────────────────────────────────────────────────────────
// End-of-utterance detection, IN-PROCESS.
//
// This is the clearest single win of the server-side architecture. In the
// browser-hosted pipeline the commitment engine runs in the tab while the
// LiveKit EOU model runs on the server, so every VAD boundary costs an HTTP
// round trip (`RemoteTurnDetector` → POST /api/turn) with a 350ms timeout and
// a heuristic fallback for when the network is slow. Here the engine and the
// scorer live in the same process: a turn decision is a function call, and the
// only latency left is the ~25ms of ONNX inference.
//
// The probability → hold mapping is LiveKit's min/max endpointing-delay model,
// identical to `RemoteTurnDetector`'s so behavior carries over unchanged:
// certain-done waits ~min, certain-not-done waits ~max, and a growing
// transcript re-scores the decision.
// ─────────────────────────────────────────────────────────────────────────────

import * as transformers from "@huggingface/transformers";
import {
  HeuristicTurnDetector,
  type TurnContextMessage,
  type TurnDecision,
  type TurnDetectorAdapter,
} from "glove-voice";
import { LiveKitEouScorer } from "glove-voice/server";

export interface LocalTurnDetectorConfig {
  /** Hold when the model is certain the speaker is done (default 400). Kept
   *  above the VAD's ~250ms resume-detection latency so a fast follow-on
   *  syllable can still cancel the commit. */
  minHoldMs?: number;
  /** Hold when the model is certain they are not (default 2800). */
  maxHoldMs?: number;
  /** Shaping exponent on (1 - P) (default 1.5). */
  curve?: number;
  /** Heuristic tiers used for the question fast-path, the dictation floor,
   *  and as the fallback whenever the model is unavailable or slow. */
  fallback?: TurnDetectorAdapter;
  /** Abandon inference after this long and use the heuristic (default 350). */
  timeoutMs?: number;
}

/** The heuristic tiers, tuned in the browser pipeline and carried over as-is. */
export const HEURISTIC_TIERS = new HeuristicTurnDetector({
  questionHoldMs: 400,
  statementHoldMs: 800,
  unfinishedHoldMs: 1200,
  dictationHoldMs: 2000,
});

let scorer: LiveKitEouScorer | null = null;

/** Process-wide scorer. The first call downloads the quantized
 *  livekit/turn-detector weights (~150MB, one-time) into the HF cache. */
export function getEouScorer(): LiveKitEouScorer {
  // `transformers` is injected rather than dynamically imported: under pnpm's
  // isolated node_modules, a bare import from inside glove-voice may not
  // resolve this app's copy.
  if (!scorer) scorer = new LiveKitEouScorer({ transformers });
  return scorer;
}

/**
 * Load the weights before the first caller needs them. The beacon calls this
 * at startup — and, crucially, only reports itself `ready()` once it resolves,
 * so the supervisor never routes a session to a gateway whose first turn would
 * pay the download cost.
 */
export async function warmEouScorer(): Promise<void> {
  await getEouScorer().init();
}

export class LocalTurnDetector implements TurnDetectorAdapter {
  private readonly minHoldMs: number;
  private readonly maxHoldMs: number;
  private readonly curve: number;
  private readonly fallback: TurnDetectorAdapter;
  private readonly timeoutMs: number;

  constructor(cfg: LocalTurnDetectorConfig = {}) {
    this.minHoldMs = cfg.minHoldMs ?? 400;
    this.maxHoldMs = cfg.maxHoldMs ?? 2800;
    this.curve = cfg.curve ?? 1.5;
    this.fallback = cfg.fallback ?? HEURISTIC_TIERS;
    this.timeoutMs = cfg.timeoutMs ?? 350;
  }

  async decide(transcript: string, context?: TurnContextMessage[]): Promise<TurnDecision> {
    const fb = await this.fallback.decide(transcript, context);
    let p: number;
    try {
      p = await withTimeout(
        getEouScorer().probability([...(context ?? []), { role: "user", content: transcript }]),
        this.timeoutMs,
      );
      if (!Number.isFinite(p)) throw new Error("scorer returned no probability");
    } catch {
      return { holdMs: fb.holdMs, reason: `fallback:${fb.reason}` };
    }

    const shaped = Math.round(
      this.minHoldMs +
        (this.maxHoldMs - this.minHoldMs) * Math.pow(1 - Math.min(Math.max(p, 0), 1), this.curve),
    );
    // Question fast-path: a transcript ending in "?"/"!" is the STT's most
    // reliable punctuation signal, and a question aimed at the agent is done
    // the moment it's asked — the model's mid-range confidence on questions
    // shouldn't slow them down.
    if (fb.reason === "question" && p >= 0.2) {
      return { holdMs: this.minHoldMs, reason: `eou-q:${p.toFixed(2)}` };
    }
    // Dictation floor: the gaps between letters of a spelled-out hull id
    // outlast anything the curve yields for a moderate probability.
    const holdMs = fb.reason === "dictation" ? Math.max(shaped, fb.holdMs) : shaped;
    return { holdMs, reason: `eou:${p.toFixed(2)}` };
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("eou timeout")), ms)),
  ]);
}
