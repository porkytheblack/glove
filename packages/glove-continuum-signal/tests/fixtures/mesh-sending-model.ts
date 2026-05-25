import type {
  Message,
  ModelAdapter,
  ModelPromptResult,
  NotifySubscribersFunction,
  PromptRequest,
  ToolCall,
} from "glove-core";

/**
 * Test-only model. On the first prompt it parses the last user message as
 * `{ to: string; content: string }` JSON and returns a tool call for
 * `glove_mesh_send_message`. On the next prompt (after the tool result has
 * been folded into the conversation) it returns plain text and stops, so the
 * agent loop exits.
 *
 * This is the minimal model that exercises the full mesh send path through a
 * continuum agent: notify arrives → model emits tool_call → executor runs
 * mesh tool → mesh adapter writes to its transport → second model call
 * returns "done".
 */
export class MeshSendingModel implements ModelAdapter {
  name = "mesh-sending-model";
  private systemPrompt = "";

  setSystemPrompt(p: string): void {
    this.systemPrompt = p;
  }

  async prompt(
    request: PromptRequest,
    notify: NotifySubscribersFunction,
  ): Promise<ModelPromptResult> {
    void this.systemPrompt;
    // If the conversation already contains a tool_result, we've completed
    // the send tool call — emit a "done" message with no further tool calls
    // so the agent loop terminates.
    const hasToolResult = request.messages.some(
      (m) => Array.isArray(m.tool_results) && m.tool_results.length > 0,
    );

    if (hasToolResult) {
      const text = "done";
      await notify("text_delta", { text });
      await notify("model_response_complete", {
        text,
        stop_reason: "end_turn",
        tokens_in: 1,
        tokens_out: 1,
      });
      return {
        messages: [{ sender: "agent", text }],
        tokens_in: 1,
        tokens_out: 1,
      };
    }

    const lastUser = [...request.messages]
      .reverse()
      .find((m) => m.sender === "user");
    let parsed: { to: string; content: string };
    try {
      parsed = JSON.parse(lastUser?.text ?? "") as {
        to: string;
        content: string;
      };
    } catch {
      const text = `bad input: ${lastUser?.text ?? ""}`;
      await notify("text_delta", { text });
      await notify("model_response_complete", {
        text,
        stop_reason: "end_turn",
        tokens_in: 1,
        tokens_out: 1,
      });
      return {
        messages: [{ sender: "agent", text }],
        tokens_in: 1,
        tokens_out: 1,
      };
    }

    const callId = "call_send_1";
    const toolCall: ToolCall = {
      tool_name: "glove_mesh_send_message",
      input_args: { to: parsed.to, content: parsed.content },
      id: callId,
    };
    await notify("tool_use", {
      id: callId,
      name: "glove_mesh_send_message",
      input: { to: parsed.to, content: parsed.content },
    });
    await notify("model_response_complete", {
      text: "",
      tool_calls: [toolCall],
      stop_reason: "tool_use",
      tokens_in: 1,
      tokens_out: 1,
    });
    const message: Message = {
      sender: "agent",
      text: "",
      tool_calls: [toolCall],
    };
    return {
      messages: [message],
      tokens_in: 1,
      tokens_out: 1,
    };
  }
}
