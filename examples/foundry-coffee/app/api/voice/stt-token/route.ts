import { createVoiceTokenHandler } from "glove-next";

// A single-use token for Scribe realtime, so the API key stays on the server.
export const GET = createVoiceTokenHandler({ provider: "elevenlabs", type: "stt" });
