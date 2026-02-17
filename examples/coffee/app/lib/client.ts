import { GloveClient } from "glove-react";
import { systemPrompt } from "./system-prompt";

export const gloveClient = new GloveClient({
  endpoint: "/api/chat",
  systemPrompt,
});
