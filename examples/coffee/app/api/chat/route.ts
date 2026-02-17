import { createChatHandler } from "glove-next";

console.log("Anthropic api key",process.env.ANTHROPIC_API_KEY)

export const POST = createChatHandler({
  provider: "anthropic",
  model: "claude-sonnet-4-5",
  apiKey: process.env.ANTHROPIC_API_KEY,
});
