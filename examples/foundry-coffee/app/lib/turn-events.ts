// What the browser is told about a run, one server-sent event each. The
// server follows Foundry's event stream and passes on only these.

export type TurnEvent =
  | { type: "run"; runId: string }
  | { type: "text"; text: string }
  /** One model response ended; more may follow after tool calls. */
  | { type: "response_end" }
  | { type: "tool"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; name: string; ok: boolean; message?: string }
  | { type: "approval"; id: string; toolName: string; input: unknown }
  | { type: "approval_resolved"; id: string; status: string }
  | { type: "speaker_named"; speaker: string; name: string }
  | { type: "end"; status: "completed" | "failed" | "cancelled"; error?: string };

export interface SpokenTurn {
  /** Notes for the model about this turn, from GloveVoice's context providers. */
  context: string[];
  /** Everyone heard so far. */
  speakers: Array<{ label: string; name?: string }>;
}

export interface TurnRequest {
  conversationId: string;
  text: string;
  /** Present when the turn was spoken. */
  voice?: SpokenTurn;
}
