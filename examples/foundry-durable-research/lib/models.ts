import { createAdapter } from "glove-core/models/providers";
import { realtimeModel } from "glove-realtime";

export function researchProvider(): "gemini" | "openai" {
  const provider = process.env.RESEARCH_PROVIDER ?? "gemini";
  if (provider !== "gemini" && provider !== "openai") throw new Error("RESEARCH_PROVIDER must be gemini or openai.");
  return provider;
}
export const frontModel = () => realtimeModel({ provider: researchProvider() });
export const textModel = () => createAdapter({
  provider: researchProvider(),
  model: process.env.RESEARCH_TEXT_MODEL ?? (researchProvider() === "openai" ? "gpt-4.1-mini" : "gemini-2.5-flash"),
  apiKey: researchProvider() === "openai" ? process.env.OPENAI_API_KEY : process.env.GEMINI_API_KEY,
  maxTokens: 2048,
});
