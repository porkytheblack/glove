/**
 * Create a short-lived Deepgram client token for real-time STT.
 * Tokens expire after time_to_live_in_seconds (max 30s per Deepgram policy).
 */
export async function createDeepgramToken(
  apiKey: string,
  ttlSeconds = 30
): Promise<string> {
  const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ time_to_live_in_seconds: ttlSeconds }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Deepgram token error (${res.status}): ${text}`);
  }

  const data = await res.json() as { key: string };
  return data.key;
}
