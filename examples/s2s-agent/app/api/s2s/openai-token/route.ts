import { createOpenAIRealtimeToken } from "glove-voice-s2s/server";

// Mint an ephemeral client secret — the real OPENAI_API_KEY never reaches the
// browser. RealtimeAgent sends instructions + tools itself via session.update
// after the data channel opens, so the token is minted plain.
export async function GET() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "OPENAI_API_KEY is not set" }, { status: 500 });
  }
  const { token } = await createOpenAIRealtimeToken({ apiKey });
  return Response.json({ token });
}
