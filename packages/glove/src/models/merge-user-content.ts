import type OpenAI from "openai";

type UserContent = OpenAI.Chat.ChatCompletionUserMessageParam["content"];

/** Preserve media blocks when framework context is adjacent to a user message. */
export function mergeUserContent(previous: UserContent, next: UserContent): UserContent {
  if (typeof previous === "string" && typeof next === "string") {
    return previous + "\n" + next;
  }
  const parts = (content: UserContent): OpenAI.Chat.ChatCompletionContentPart[] =>
    typeof content === "string" ? [{ type: "text", text: content }] : content;
  return [...parts(previous), ...parts(next)];
}
