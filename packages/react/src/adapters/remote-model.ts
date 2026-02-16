import type {
  ModelAdapter,
  Message,
  PromptRequest,
  ModelPromptResult,
  NotifySubscribersFunction,
  Tool,
} from "@glove/core/core";
import z from "zod";

// ─── Public types ────────────────────────────────────────────────────────────

/** Serialized tool definition safe for JSON transport */
export interface SerializedTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** What the user's backend receives */
export interface RemotePromptRequest {
  systemPrompt: string;
  messages: Message[];
  tools?: SerializedTool[];
}

/** What the user's backend returns (sync mode) */
export interface RemotePromptResponse {
  message: Message;
  tokens_in: number;
  tokens_out: number;
}

/** Streaming events from the user's backend */
export type RemoteStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "done"; message: Message; tokens_in: number; tokens_out: number };

/**
 * User-provided async functions for model communication.
 *
 * At minimum, provide `prompt` (sync mode).
 * Optionally provide `promptStream` for real-time streaming (text deltas, tool calls).
 */
export interface RemoteModelActions {
  /** Sync mode — send request, get full response */
  prompt: (
    request: RemotePromptRequest,
    signal?: AbortSignal,
  ) => Promise<RemotePromptResponse>;

  /** Streaming mode — if provided, used instead of prompt */
  promptStream?: (
    request: RemotePromptRequest,
    signal?: AbortSignal,
  ) => AsyncIterable<RemoteStreamEvent>;
}

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
 * Creates a `ModelAdapter` that delegates prompts to the user's backend.
 *
 * ```ts
 * const model = createRemoteModel("my-model", {
 *   async prompt(req, signal) {
 *     const res = await fetch("/api/chat", {
 *       method: "POST",
 *       body: JSON.stringify(req),
 *       signal,
 *     });
 *     return res.json();
 *   },
 * });
 * ```
 *
 * Tool definitions are automatically serialized to JSON Schema (Zod schemas
 * and `run` functions are stripped) before being passed to the backend.
 *
 * @param name    - Display name for the model (e.g. "gpt-4o", "my-backend")
 * @param actions - User-provided prompt/stream functions
 */
export function createRemoteModel(
  name: string,
  actions: RemoteModelActions,
): ModelAdapter {
  let systemPrompt = "";

  return {
    name,

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

      // ── Streaming path ───────────────────────────────────────────────────

      if (actions.promptStream) {
        let finalMessage: Message | null = null;
        let tokensIn = 0;
        let tokensOut = 0;

        for await (const event of actions.promptStream(remoteReq, signal)) {
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
          throw new Error(
            "Remote model stream ended without a 'done' event",
          );
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
      }

      // ── Sync path ────────────────────────────────────────────────────────

      const result = await actions.prompt(remoteReq, signal);

      await notify("model_response", {
        text: result.message.text,
        tool_calls: result.message.tool_calls,
      });

      return {
        messages: [result.message],
        tokens_in: result.tokens_in,
        tokens_out: result.tokens_out,
      };
    },
  };
}
