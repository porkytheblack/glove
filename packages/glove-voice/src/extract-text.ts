import { ContentPart, Message, ModelPromptResult } from "glove-core";

/**
 * Extract the agent's text response from whatever Glove returns.
 * Handles both Message and ModelPromptResult shapes.
 */
export function extractText(result: Message | ModelPromptResult): string {
  if (!result || typeof result !== "object") return "";

  if ("messages" in result) {
    const last = [...result.messages]
      .reverse()
      .find((m) => m.sender === "agent");

    if (!last) return "";
    return extractFromMessage(last);
  }

  return extractFromMessage(result);
}

function extractFromMessage(m: Message): string {
  if (m.sender !== "agent") return "";

  if (m.content?.length) {
    return m.content
      .filter((p): p is ContentPart & { text: string } =>
        p.type === "text" && typeof p.text === "string"
      )
      .map((p) => p.text)
      .join(" ")
      .trim();
  }

  return m.text;
}
