import type { DisplayMessage, DisplayTool } from "../shared";

/** The parts of a Glove message this reads (a Foundry transcript's `messages`). */
export interface TranscriptMessage {
  readonly sender: "user" | "agent";
  readonly text: string;
  readonly pre_modified_text?: string;
  readonly framework_context?: string;
  readonly is_compaction?: boolean;
  readonly is_compaction_request?: boolean;
  readonly is_skill_injection?: boolean;
  readonly tool_calls?: ReadonlyArray<{ readonly tool_name: string; readonly input_args: unknown; readonly id?: string }>;
  readonly tool_results?: ReadonlyArray<{ readonly tool_name: string; readonly call_id?: string; readonly result: { readonly status: string } }>;
}

/** A tool's line or chip, worked out on the server from its name and input. */
export type ToolLabel = string | { readonly label: string; readonly chip?: boolean } | undefined;

export interface DisplayOptions {
  /**
   * A message the person didn't type: an inbound transmission, a sibling's
   * message, a task. Return a short line to show it, or null to leave it out.
   * By default an inbound transmission shows as "<transmission> · <event>"
   * and anything else framework-shaped is left out.
   */
  readonly incoming?: (text: string) => string | null;
  /** A label for a tool call. Its input stays on the server. */
  readonly describeTool?: (name: string, input: unknown) => ToolLabel;
}

/** What `describeTool` returned, as display fields. */
export function toolLabel(label: ToolLabel): Pick<DisplayTool, "label" | "chip"> {
  if (!label) return {};
  return typeof label === "string" ? { label } : { label: label.label, ...(label.chip ? { chip: true } : {}) };
}

/** The default reading of a framework message: an inbound transmission by name, nothing else. */
export function defaultIncoming(text: string): string | null {
  const transmission = /^<transmission direction="inbound" definition="([^"]+)"[^>]*event="([^"]+)"/.exec(text);
  return transmission ? `${transmission[1]} · ${transmission[2]}` : null;
}

const framework = (text: string) => /^<[a-z][\w-]*[\s>]/i.test(text.trimStart()) || /^\[Skill: /.test(text);

/**
 * A Glove transcript as a person sees it: their messages, the agent's
 * replies with the tools it used above each reply, and short lines for what
 * arrived from elsewhere. Tool input and results, system text and framework
 * turns are dropped. `offset` is the transcript page's offset, for stable ids.
 */
export function displayMessages(
  transcript: { readonly messages: ReadonlyArray<TranscriptMessage>; readonly page?: { readonly offset: number } },
  options: DisplayOptions = {},
): DisplayMessage[] {
  const offset = transcript.page?.offset ?? 0;
  const incoming = options.incoming ?? defaultIncoming;
  const out: DisplayMessage[] = [];
  // Tools called before the reply they belong to, by call id.
  let carry: Array<DisplayTool & { readonly callId?: string }> = [];
  const byCall = new Map<string, { index: number; tool: number }>();
  const status = (result: { readonly status: string }): DisplayTool["status"] => result.status === "success" ? "done" : "error";

  transcript.messages.forEach((message, index) => {
    const id = String(offset + index);
    if (message.framework_context || message.is_compaction || message.is_compaction_request || message.is_skill_injection) return;
    if (message.sender === "user") {
      if (message.tool_results?.length) {
        for (const result of message.tool_results) {
          const pending = carry.find((tool) => tool.callId === result.call_id && tool.status === "running")
            ?? carry.find((tool) => tool.name === result.tool_name && tool.status === "running");
          if (pending) {
            carry = carry.map((tool) => tool === pending ? { ...tool, status: status(result.result) } : tool);
            continue;
          }
          const placed = result.call_id ? byCall.get(result.call_id) : undefined;
          const target = placed ? out[placed.index] : undefined;
          if (placed && target?.tools) {
            out[placed.index] = { ...target, tools: target.tools.map((tool, i) => i === placed.tool ? { ...tool, status: status(result.result) } : tool) };
          }
        }
        return;
      }
      const text = message.pre_modified_text ?? message.text;
      if (framework(text)) {
        const line = incoming(text);
        if (line) out.push({ id, sender: "event", text: line });
        return;
      }
      out.push({ id, sender: "person", text });
      return;
    }
    for (const call of message.tool_calls ?? []) {
      carry.push({ name: call.tool_name, status: "running", ...toolLabel(options.describeTool?.(call.tool_name, call.input_args)), ...(call.id ? { callId: call.id } : {}) });
    }
    if (!message.text.trim()) return;
    out.push(reply(id, message.text, carry, out.length, byCall));
    carry = [];
  });
  if (carry.length > 0) out.push(reply(String(offset + transcript.messages.length), "", carry, out.length, byCall));
  return out;
}

function reply(
  id: string,
  text: string,
  carry: ReadonlyArray<DisplayTool & { readonly callId?: string }>,
  index: number,
  byCall: Map<string, { index: number; tool: number }>,
): DisplayMessage {
  carry.forEach((tool, position) => { if (tool.callId) byCall.set(tool.callId, { index, tool: position }); });
  const tools = carry.map(({ callId: _callId, ...tool }) => tool);
  return { id, sender: "agent", text, ...(tools.length > 0 ? { tools } : {}) };
}
