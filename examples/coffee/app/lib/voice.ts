import { createElevenLabsAdapters } from "glove-voice";

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
