import { createChatHandler } from "glove-next";

export const POST = createChatHandler({
  provider: "openrouter",
  model: "z-ai/glm-5",
  apiKey: process.env.OPENROUTER_API_KEY
});
