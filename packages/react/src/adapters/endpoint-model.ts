import type {
  ModelAdapter,
  PromptRequest,
  ModelPromptResult,
  NotifySubscribersFunction,
  Message,
  Tool,
} from "@glove/core/core";
import { parseSSEStream } from "../sse";
import type { RemotePromptRequest, SerializedTool } from "./remote-model";
import z from "zod";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function serializeTools(
  tools: Array<Tool<unknown>> | undefined,
): SerializedTool[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: z.toJSONSchema(t.input_schema) as Record<string, unknown>,
  }));
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Creates a `ModelAdapter` that communicates with a server endpoint via SSE.
 *
 * The endpoint receives `RemotePromptRequest` and streams `RemoteStreamEvent`s
 * using the Server-Sent Events protocol.
 *
 * This is the internal adapter used when `useGlove({ endpoint: "..." })` is called.
 *
 * @param endpoint - URL to POST prompt requests to (e.g. "/api/chat")
 */
export function createEndpointModel(endpoint: string): ModelAdapter {
  let systemPrompt = "";

  return {
    name: `endpoint:${endpoint}`,

    setSystemPrompt(sp: string) {
      systemPrompt = sp;
    },

    async prompt(
      request: PromptRequest,
      notify: NotifySubscribersFunction,
      signal?: AbortSignal,
    ): Promise<ModelPromptResult> {
      const remoteReq: RemotePromptRequest = {
        systemPrompt,
        messages: request.messages,
        tools: serializeTools(request.tools),
      };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(remoteReq),
        signal,
      });

      if (!response.ok) {
        throw new Error(
          `Chat endpoint error: ${response.status} ${response.statusText}`,
        );
      }

      let finalMessage: Message | null = null;
      let tokensIn = 0;
      let tokensOut = 0;

      for await (const event of parseSSEStream(response)) {
        switch (event.type) {
          case "text_delta":
            await notify("text_delta", { text: event.text });
            break;
          case "tool_use":
            await notify("tool_use", {
              id: event.id,
              name: event.name,
              input: event.input,
            });
            break;
          case "done":
            finalMessage = event.message;
            tokensIn = event.tokens_in;
            tokensOut = event.tokens_out;
            break;
        }
      }

      if (!finalMessage) {
        throw new Error("Stream ended without a 'done' event");
      }

      await notify("model_response_complete", {
        text: finalMessage.text,
        tool_calls: finalMessage.tool_calls,
      });

      return {
        messages: [finalMessage],
        tokens_in: tokensIn,
        tokens_out: tokensOut,
      };
    },
  };
}
