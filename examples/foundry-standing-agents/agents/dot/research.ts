import type { IGloveRunnable } from "glove-core";
import { defineSchedule, type FoundryRequest } from "glove-foundry";
import { z } from "zod";
import { aroundTool } from "../../lib/tool-policy.js";
import slackMessages from "./transmissions/slack-messages.transmission.js";

/**
 * Proactive research. Every two hours (DOTS_RESEARCH_EVERY, such as 24h) the
 * dot wakes on its own, reads the sources of every responsibility it holds,
 * keeps notes and may bring one suggestion. Its tools on these runs only read: they cannot send messages,
 * change anything or control its computer. The schedule joins the
 * conversation of the run that first syncs it, so onboarding sends the first
 * message in the app conversation.
 */
export const research = defineSchedule({
  name: "research",
  description: "Read the sources of every responsibility, keep notes, suggest at most one thing",
  timing: { kind: "every", interval: process.env.DOTS_RESEARCH_EVERY ?? "2h" },
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
 * A follow-up: a run the dot started on a run that could act, such as a
 * schedule the person set or work it split off. followUps() stamps its
 * payload, and Foundry passes the payload on. Transmissions never count,
 * whatever their payload says.
 */
export function followUp(request: FoundryRequest): boolean {
  const kind = request.source?.kind;
  return (kind === "activation" || kind === "spawn" || kind === "background")
    && (request.payload as { followUp?: unknown } | null | undefined)?.followUp === true;
}

/**
 * Runs that only read: the research schedule, wake-ups, new mail, and every
 * run of a paused dot. A run the person started, a follow-up of one, or the
 * builder's reply may act, under the Custom Rules.
 */
export function readOnly(request: FoundryRequest, dot?: { readonly paused?: unknown }): boolean {
  if (dot?.paused === true) return true;
  return !(startedByPerson(request) || followUp(request) || request.source?.kind === "mesh");
}

/** Foundry's tools that start runs of the dot, now or later. */
const STARTS_RUNS = ["glove_foundry_schedule", "glove_foundry_spawn", "glove_foundry_background"];

/**
 * Follow-ups. On a run that may act, every run the dot starts with Foundry's
 * tools carries `followUp: true`, so it acts under the same rules; a spawn
 * with no target is a run of this dot. On a read-only run those tools are gone
 * and schedules can only be listed, so research can't start a run that acts
 * or change one.
 */
export function followUps(agent: IGloveRunnable, agentId: string, acts: boolean): void {
  if (!acts) {
    for (const name of STARTS_RUNS) aroundTool(agent, name, () => undefined);
    aroundTool(agent, "glove_foundry_schedules", (schedules) => ({
      name: schedules.name,
      description: "List your schedules. On this run you can't create or change them.",
      inputSchema: z.object({ status: z.enum(["active", "paused", "completed", "cancelled", "all"]).default("active") }),
      do: (input: { status: string }, _display, _glove, signal) => schedules.run({ action: "list", ...input }, signal),
    }));
    return;
  }
  for (const name of STARTS_RUNS) {
    aroundTool(agent, name, ({ run, ...tool }) => ({
      ...tool,
      do: (input: Record<string, unknown>, _display, _glove, signal) => run({
        ...input,
        ...(name === "glove_foundry_spawn" && !input.agentId && !input.definitionId ? { agentId } : {}),
        payload: { followUp: true, ...(input.payload !== undefined ? { payload: input.payload } : {}) },
      }, signal),
    }));
  }
  // An update never changes what a schedule carries, so no run can stamp the
  // research schedule and make research act.
  aroundTool(agent, "glove_foundry_schedules", ({ run, ...tool }) => ({
    ...tool,
    do: (input: Record<string, unknown>, _display, _glove, signal) => {
      const { payload: _payload, ...kept } = input;
      return run(kept, signal);
    },
  }));
}
