import { defineSchedule, type FoundryRequest } from "glove-foundry";
import slackMessages from "./transmissions/slack-messages.transmission.js";

/**
 * Proactive research. Every two hours the dot wakes on its own, reads the
 * sources of every responsibility it holds, keeps notes and may bring one
 * suggestion. Its tools on these runs only read: they cannot send messages,
 * change anything or control its computer. The schedule joins the
 * conversation of the run that first syncs it, so onboarding sends the first
 * message in the app conversation.
 */
export const research = defineSchedule({
  name: "research",
  description: "Read the sources of every responsibility, keep notes, suggest at most one thing",
  timing: { kind: "every", interval: "2h" },
  message: [
    "Research time. Nobody is waiting on you.",
    "Read the sources of each of your responsibilities, keep what you find in your notes with keep_note,",
    "and bring at most one suggestion or question with suggest. If nothing deserves attention, say so in one line.",
  ].join(" "),
});

/**
 * Runs the person started: from the app, or by messaging the dot in Slack
 * (only the owner's Slack messages reach it). New mail is from anyone, so it
 * does not count.
 */
export function startedByPerson(request: FoundryRequest): boolean {
  if (request.source?.kind === "direct") return true;
  return request.source?.kind === "transmission" && request.source.provider === slackMessages.id;
}

/**
 * Runs on the dot's own time: the research schedule, wake-ups, work it
 * spawned for itself, and new mail. They get only read-only tools. A run the
 * person started, or the builder's reply to work they started, may act.
 */
export function readOnly(request: FoundryRequest): boolean {
  return !(startedByPerson(request) || request.source?.kind === "mesh");
}
