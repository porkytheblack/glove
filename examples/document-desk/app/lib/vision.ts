/**
 * The vision seam, wired to an OpenAI-compatible chat endpoint.
 *
 * `glove-working-environment` deliberately takes a plain function here rather
 * than a model adapter, so this is the whole integration — swap the fetch for
 * whatever you already run and nothing else changes.
 *
 * Returns `null` when no key is configured, which leaves `view_image` out of
 * the agent's tool list entirely. That is the right default: an agent shown a
 * verb it cannot use spends a call discovering that.
 */
import type { VisionAdapter } from "glove-working-environment";

const OPENROUTER = "https://openrouter.ai/api/v1/chat/completions";

export function visionAdapter(): VisionAdapter | undefined {
  const key = process.env.OPENROUTER_API_KEY ?? process.env.VISION_API_KEY;
  if (!key) return undefined;

  const model = process.env.VISION_MODEL ?? "google/gemini-2.5-flash";
  const endpoint = process.env.VISION_BASE_URL ?? OPENROUTER;

  return {
    async describe({ bytes, mediaType, prompt }) {
      // A data URI rather than an upload: the image never leaves this process
      // except to the model, and there is no bucket to clean up afterwards.
      const dataUrl = `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                { type: "image_url", image_url: { url: dataUrl } },
              ],
            },
          ],
        }),
      });

      if (!res.ok) {
        // Surfaced to the agent as a tool error, so it can retry or move on
        // rather than treating an outage as "the document is fine".
        throw new Error(`vision model ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const answer = body.choices?.[0]?.message?.content;
      if (!answer) throw new Error("vision model returned no description");
      return answer;
    },
  };
}
