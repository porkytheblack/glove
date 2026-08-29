export const SAMPLE_RATE = 16_000;

export type CallClientMessage =
  | { readonly t: "say"; readonly text: string }
  | { readonly t: "barge_in" };

export type CallServerMessage =
  | { readonly t: "ready"; readonly sessionId: string; readonly agent: string; readonly model: string; readonly tools: ReadonlyArray<string> }
  | { readonly t: "utterance"; readonly text: string }
  | { readonly t: "speech"; readonly turnId: number; readonly text: string }
  | { readonly t: "speech_end"; readonly turnId: number }
  | { readonly t: "tool"; readonly name: string; readonly phase: "start" | "done" | "error" }
  | { readonly t: "state"; readonly state: "listening" | "thinking" | "speaking" }
  | { readonly t: "clear" }
  | { readonly t: "error"; readonly message: string };
