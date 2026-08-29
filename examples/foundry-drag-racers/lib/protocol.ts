export const SAMPLE_RATE = 16_000;

export type ClientMessage =
  | { readonly t: "say"; readonly text: string }
  | { readonly t: "barge_in" }
  | { readonly t: "playback_done"; readonly turnId: number };

export type ServerMessage =
  | { readonly t: "ready"; readonly sessionId: string; readonly racer: string; readonly model: string; readonly tools: ReadonlyArray<string> }
  | { readonly t: "utterance"; readonly text: string }
  | { readonly t: "speech"; readonly turnId: number; readonly text: string }
  | { readonly t: "speech_end"; readonly turnId: number }
  | { readonly t: "tool"; readonly name: string; readonly phase: "start" | "done" | "error" }
  | { readonly t: "state"; readonly state: "listening" | "thinking" | "speaking" }
  | { readonly t: "clear" }
  | { readonly t: "error"; readonly message: string };
