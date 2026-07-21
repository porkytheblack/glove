import { createVoiceTokenHandler } from "glove-next";

// Exchanges the server-side ELEVENLABS_API_KEY for a short-lived Scribe
// (speech-to-text) token. The browser never sees the real key.
export const runtime = "nodejs";
export const GET = createVoiceTokenHandler({ provider: "elevenlabs", type: "stt" });
