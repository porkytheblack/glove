import * as transformers from "@huggingface/transformers";
import { LiveKitEouScorer } from "glove-voice/server";

// Singleton end-of-utterance scorer (survives Next.js HMR). The first init
// downloads the quantized livekit/turn-detector weights (~150MB, one-time)
// into the HF cache and takes a few seconds — session creation warms it
// fire-and-forget so the first spoken turn doesn't pay that cost.
const g = globalThis as unknown as { __eouScorer?: LiveKitEouScorer };

export function getEouScorer(): LiveKitEouScorer {
  if (!g.__eouScorer) g.__eouScorer = new LiveKitEouScorer({ transformers });
  return g.__eouScorer;
}

export function warmEouScorer(): void {
  void getEouScorer()
    .init()
    .catch(() => {
      /* scoring route reports real errors; RemoteTurnDetector falls back */
    });
}
