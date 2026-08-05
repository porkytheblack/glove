// ─────────────────────────────────────────────────────────────────────────────
// Custom senders — application-layer convention
//
// glove-core's `Message.sender` is only `"user" | "agent"`; the model adapters
// collapse it to `role: user/assistant` with no name field. So there is no
// first-class "this message is from a *different* person" today.
//
// The framework's own pattern (see glove-mesh, which folds peer identity into
// inbox text like `Message from "Voice Front" (front)`) is to encode the
// speaker identity INTO the message text. Every utterance Nova hears is
// prefixed with a speaker label; SHE decides whether the line was addressed to
// her, and signals speech via <speech> tags (see front-agent.ts).
// ─────────────────────────────────────────────────────────────────────────────

import type { Speaker, SpeakerRole } from "./protocol";

export const ASSISTANT_NAME = "Nova";

export const SPEAKERS: Speaker[] = [
  {
    id: "operator",
    displayName: "Rae (you)",
    shortName: "Rae",
    description:
      "The buyer, here to buy their FIRST ship. Has never owned one, has flown as a passenger and nothing more, and does not know the vocabulary — not tonnage, not fold range, not what a drive rating means. Knows what they want to DO, not what they want to buy. This is who Nova is selling to.",
  },
  {
    id: "customer",
    displayName: "Jules (came along)",
    shortName: "Jules",
    description:
      "Rae's friend, along for the visit. Knows nothing about ships either but asks the blunt practical questions Rae is too polite to — what it really costs to run, whether it is safe, whether Rae is being upsold. Sometimes talks to Rae, sometimes to Nova.",
  },
  {
    id: "bystander",
    displayName: "Kit (technician)",
    shortName: "Kit",
    description:
      "A technician crossing the showroom floor. Mostly talks to colleagues, not to Nova, but will give a blunt maintenance opinion if asked directly.",
  },
];

const byId = new Map(SPEAKERS.map((s) => [s.id, s]));

export function speaker(role: SpeakerRole): Speaker {
  return byId.get(role) ?? SPEAKERS[0];
}

/** Label for a speaker, e.g. "Sam (operator)". */
export function speakerLabel(role: SpeakerRole): string {
  const s = speaker(role);
  return `${s.shortName} (${role})`;
}

/**
 * Frame one transcribed utterance for the front agent. Every line in the room
 * reaches Nova with its speaker label; whether it was aimed at her is HER call.
 */
export function frameUtterance(role: SpeakerRole, text: string): string {
  return `[${speakerLabel(role)}] ${text}`;
}

/** The speaker roster, rendered for the front agent's system prompt. */
export function rosterForPrompt(): string {
  return SPEAKERS.map((s) => `- ${s.shortName} (${s.id}): ${s.description}`).join("\n");
}
