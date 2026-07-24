import { createVoiceTokenHandler } from "glove-next";

// Exchanges the server-side ELEVENLABS_API_KEY for a short-lived TTS
// (text-to-speech) token used to stream Nova's voice to the browser.
export const runtime = "nodejs";
export const GET = createVoiceTokenHandler({ provider: "elevenlabs", type: "tts" });
