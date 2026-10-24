import { defineSchedule, type FoundryRequest } from "glove-foundry";

/**
 * Proactive research. Every two hours the dot wakes on its own, reads its
 * sources, keeps notes and may bring one suggestion. The schedule joins the
 * conversation of the run that first syncs it, so onboarding sends the first
 * message in the app conversation.
 */
export const research = defineSchedule({
  name: "research",
  description: "Read the sources, keep notes, suggest at most one thing",
  timing: { kind: "every", interval: "2h" },
  message: [
    "Research time. Nobody is waiting on you.",
    "Read each of your sources, keep what you find in your notes with keep_note,",
    "and bring at most one suggestion or question with suggest. If nothing deserves attention, say so in one line.",
  ].join(" "),
});

/** Runs the person started: from the app, or by messaging the dot in Slack. */
export function startedByPerson(request: FoundryRequest): boolean {
  return request.source?.kind === "direct" || request.source?.kind === "transmission";
}

/**
 * Runs on the dot's own time: the research schedule, wake-ups, and work it
 * spawned for itself. They get only read-only tools. A run the person
 * started, or the builder's reply to work they started, may act.
 */
export function readOnly(request: FoundryRequest): boolean {
  return !(startedByPerson(request) || request.source?.kind === "mesh");
}
