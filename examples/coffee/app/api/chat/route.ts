import { createChatHandler } from "glove-next";

export const POST = createChatHandler({
  provider: "lmstudio",
  model: "openai/gpt-oss-20b",
  baseURL: "http://cubicon:1234/v1"
});
