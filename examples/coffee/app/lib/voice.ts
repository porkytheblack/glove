import { createElevenLabsAdapters } from "glove-voice";
import { PRODUCTS } from "./products";

async function fetchToken(path: string): Promise<string> {
  const res = await fetch(path);
  const data = (await res.json()) as { token?: string; error?: string };
  if (!res.ok || !data.token) {
    throw new Error(data.error ?? `Token fetch failed (${res.status})`);
  }
  return data.token;
}

// ElevenLabs STT + TTS adapters
export const { stt, createTTS } = createElevenLabsAdapters({
  getSTTToken: () => fetchToken("/api/voice/stt-token"),
  getTTSToken: () => fetchToken("/api/voice/tts-token"),
  voiceId: "56bWURjYFHyYyVf490Dp", // "George" — warm, friendly
  stt: {
    // Scribe v3 Live keyterms: origin names like "Yirgacheffe" and
    // "Mandheling" are exactly what speech recognition gets wrong. Realtime
    // keyterms are limited to 50 terms of 20 characters, and ElevenLabs may
    // bill keyterm prompting at a higher rate; remove this to opt out.
    keyterms: PRODUCTS.map((p) => p.name).filter((name) => name.length <= 20).slice(0, 50),
  },
});

// Silero VAD — dynamically imported to avoid pulling onnxruntime-web (WASM)
// into the Next.js server bundle during SSR/prerendering.
export async function createSileroVAD() {
  const { SileroVADAdapter } = await import("glove-voice/silero-vad");
  const vad = new SileroVADAdapter({
    positiveSpeechThreshold: 0.5,
    negativeSpeechThreshold: 0.35,
    wasm: { type: "cdn" },
  });
  await vad.init();
  return vad;
}
