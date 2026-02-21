import { createVoiceTokenHandler } from "glove-next";

export const GET = createVoiceTokenHandler({ provider: "elevenlabs", type: "stt" });
