import type { FoundryRequest } from "glove-foundry";
import type { TurnPayload } from "../../lib/shop.js";

// What a spoken turn carries. The browser runs the voice pipeline (GloveVoice
// with Scribe v3 Live) and sends each finished utterance as an ordinary
// message; who is speaking rides in the request payload, never in the
// transcript.

export interface VoiceTurn {
  /** The message was spoken, not typed. */
  readonly spoken: boolean;
  /** Notes for the model about this turn: how to read speaker labels, who is here. */
  readonly context: readonly string[];
  /** Everyone heard so far, by the label the model sees in the message. */
  readonly speakers: ReadonlyArray<{ readonly label: string; readonly name?: string }>;
}

export function voiceTurn(request: FoundryRequest): VoiceTurn {
  const voice = (request.payload as TurnPayload | undefined)?.voice;
  return {
    spoken: voice !== undefined,
    context: (voice?.context ?? []).filter((note) => typeof note === "string" && note.trim().length > 0),
    speakers: voice?.speakers ?? [],
  };
}
