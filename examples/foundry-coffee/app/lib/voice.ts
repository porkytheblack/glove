import { ElevenLabsSTTAdapter, ElevenLabsTTSAdapter, type TTSFactory, type TurnMode } from "glove-voice";
import { PRODUCTS } from "../../lib/catalog";

// The voice pipeline's adapters. Everything Scribe v3 Live adds is switched
// on here, with the settings exposed in the UI so each can be compared.

/** Who decides the customer has finished speaking. */
export type TurnDetection =
  /** Scribe v3 Live predicts the end of the turn (commit_strategy: turn_prediction). */
  | "scribe-turn"
  /** Scribe commits after a silence (commit_strategy: vad). */
  | "scribe-vad"
  /** The local VAD commits after its silence window, as before Scribe v3. */
  | "local-vad";

export interface VoiceSettings {
  turns: TurnDetection;
  /** Tell speakers apart (diarize) and label lines for the barista. */
  speakers: boolean;
}

export const DEFAULT_VOICE: VoiceSettings = { turns: "scribe-turn", speakers: true };

export const TURN_LABELS: Record<TurnDetection, string> = {
  "scribe-turn": "Scribe turn prediction",
  "scribe-vad": "Scribe VAD",
  "local-vad": "Local VAD",
};

async function fetchToken(path: string): Promise<string> {
  const response = await fetch(path);
  const data = (await response.json()) as { token?: string; error?: string };
  if (!response.ok || !data.token) throw new Error(data.error ?? `Token request failed (${response.status})`);
  return data.token;
}

const MODEL = process.env.NEXT_PUBLIC_SCRIBE_MODEL || "scribe_v3_live";
const VOICE_ID = process.env.NEXT_PUBLIC_ELEVENLABS_VOICE_ID || "56bWURjYFHyYyVf490Dp"; // "George"

export interface VoiceAdapters {
  stt: ElevenLabsSTTAdapter;
  createTTS: TTSFactory;
  turnMode: TurnMode;
  model: string;
}

export function createVoiceAdapters(settings: VoiceSettings): VoiceAdapters {
  const stt = new ElevenLabsSTTAdapter({
    getToken: () => fetchToken("/api/voice/stt-token"),
    model: MODEL,
    // With "local-vad" Scribe only transcribes; GloveVoice commits.
    ...(settings.turns === "scribe-turn" ? { commitStrategy: "turn_prediction" as const } : {}),
    ...(settings.turns === "scribe-vad" ? { commitStrategy: "vad" as const } : {}),
    diarize: settings.speakers,
    // Origin names are what speech recognition gets wrong. Realtime keyterms
    // are limited to 50 terms of 20 characters.
    keyterms: PRODUCTS.map((p) => p.name).filter((name) => name.length <= 20).slice(0, 50),
  });

  const createTTS: TTSFactory = () =>
    new ElevenLabsTTSAdapter({ getToken: () => fetchToken("/api/voice/tts-token"), voiceId: VOICE_ID });

  return { stt, createTTS, turnMode: settings.turns === "local-vad" ? "vad" : "stt", model: MODEL };
}

// Silero VAD, imported on demand so onnxruntime-web stays out of the server bundle.
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
