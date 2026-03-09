import { createChatHandler } from "glove-next";

export const POST = createChatHandler({
  provider: "openrouter",
  model: "minimax/minimax-m2.5"
});
