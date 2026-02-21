/**
 * Create a short-lived Cartesia token for TTS WebSocket.
 */
export async function createCartesiaToken(apiKey: string): Promise<string> {
  const res = await fetch("https://api.cartesia.ai/audio/tokens", {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Cartesia-Version": "2024-06-10",
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cartesia token error (${res.status}): ${text}`);
  }

  const data = await res.json() as { jwt: string };
  return data.jwt;
}
