// ─────────────────────────────────────────────────────────────────────────────
// Custom senders — application-layer convention
//
// glove-core's `Message.sender` is only `"user" | "agent"`; the model adapters
// collapse it to `role: user/assistant` with no name field. So there is no
// first-class "this message is from a *different* person" today.
//
// The framework's own pattern (see glove-mesh, which folds peer identity into
// inbox text like `Message from "Voice Front" (front)`) is to encode the
// speaker identity INTO the message text. This module is that convention, made
// explicit and reusable: every utterance is wrapped in a labelled envelope so
// both the addressing-monitor and Nova can tell the speakers apart — and, just
// as importantly, tell whether a line was said *to* Nova or merely overheard.
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
 * Frame an utterance that the monitor decided IS addressed to Nova. This is
 * what gets fed into the front agent's `processRequest`. The `→ you` marker
 * tells Nova this line is for her.
 */
export function frameAddressed(role: SpeakerRole, text: string): string {
  return `[${speakerLabel(role)} → ${ASSISTANT_NAME}] ${text}`;
}

/**
 * Frame an utterance that was NOT addressed to Nova. This is appended to the
 * front agent's context (via store.appendMessages) WITHOUT triggering a
 * response, so Nova keeps situational awareness of the room without barging in.
 */
export function frameOverheard(role: SpeakerRole, text: string): string {
  return `[overheard · ${speakerLabel(role)}, not addressed to ${ASSISTANT_NAME}] ${text}`;
}

/** The speaker roster, rendered for the monitor's system prompt. */
export function rosterForMonitor(): string {
  return SPEAKERS.map((s) => `- ${s.shortName} (${s.id}): ${s.description}`).join("\n");
}
