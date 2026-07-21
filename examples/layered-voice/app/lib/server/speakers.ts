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

import type { Speaker, SpeakerRole } from "../shared/types";

export const ASSISTANT_NAME = "Nova";

export const SPEAKERS: Speaker[] = [
  {
    id: "operator",
    displayName: "Sam (you)",
    shortName: "Sam",
    description:
      "The Orbital Dynamics front-desk associate running this session. Talks to Nova to get work done, and also talks directly to the customer in the room.",
  },
  {
    id: "customer",
    displayName: "Dr. Okonkwo (walk-in)",
    shortName: "Dr. Okonkwo",
    description:
      "A customer physically at the desk. Owns an old Kestrel L2 hauler, hull KES-0007, nicknamed \"Rustbucket\". Sometimes speaks to Sam, sometimes to Nova.",
  },
  {
    id: "bystander",
    displayName: "Kit (technician)",
    shortName: "Kit",
    description:
      "A technician passing through the front desk. Mostly talks to Sam; rarely addresses Nova.",
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
