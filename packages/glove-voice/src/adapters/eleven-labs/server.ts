/**
 * Server-side token generation helpers for ElevenLabs.
 *
 * Import these in your API routes — NOT in client code.
 * These functions hold your ElevenLabs API key and return
 * short-lived single-use tokens safe to pass to the browser.
 *
 * @example Next.js App Router
 *
 * // app/api/voice/stt-token/route.ts
 * import { createElevenLabsSTTToken } from "glove-voice/server";
 * export async function GET() {
 *   const token = await createElevenLabsSTTToken(process.env.ELEVENLABS_API_KEY!);
 *   return Response.json({ token });
 * }
 *
 * // app/api/voice/tts-token/route.ts
 * import { createElevenLabsTTSToken } from "glove-voice/server";
 * export async function GET() {
 *   const token = await createElevenLabsTTSToken(process.env.ELEVENLABS_API_KEY!);
 *   return Response.json({ token });
 * }
 */

/**
 * Create a single-use token for Scribe Realtime (STT WebSocket).
 * Valid for 15 minutes — generate fresh per session.
 */
export async function createElevenLabsSTTToken(apiKey: string): Promise<string> {
  return createElevenLabsToken(apiKey, "realtime_scribe");
}

/**
 * Create a single-use token for TTS Input Streaming (TTS WebSocket).
 * Valid for 15 minutes — generate fresh per session.
 */
export async function createElevenLabsTTSToken(apiKey: string): Promise<string> {
  return createElevenLabsToken(apiKey, "tts_websocket");
}

async function createElevenLabsToken(
  apiKey: string,
  tokenType: "realtime_scribe" | "tts_websocket"
): Promise<string> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/single-use-token/${tokenType}`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey },
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ElevenLabs token error (${res.status}): ${text}`);
  }

  const data = await res.json() as { token: string };
  return data.token;
}
