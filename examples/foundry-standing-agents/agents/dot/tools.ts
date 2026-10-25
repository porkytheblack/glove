import type { GloveFoldArgs } from "glove-core";
import type { AgentAssemblyContext } from "glove-foundry";
import { actionsFor } from "../../lib/actions.js";
import { reviewed } from "../../lib/auto-review.js";
import { currentDot } from "../../lib/dot.js";
import { knownContacts, researchTools } from "../../lib/sources.js";
import { readOnly } from "./research.js";

/**
 * Runs on the dot's own time (research, wake-ups, spawned work) get the
 * read-only tools and nothing else: the acting tools are absent, not refused.
 * Other runs also get the acting tools, each wrapped by auto-review.
 */
export async function dotTools(ctx: AgentAssemblyContext): Promise<GloveFoldArgs<any>[]> {
  const read = researchTools(ctx.agentId);
  if (readOnly(ctx.request)) return read;
  const dot = await currentDot(ctx);
  const review = {
    owner: dot.owner,
    rules: dot.rules,
    contacts: await knownContacts(),
    tellPerson: dot.routing.decisions === "slack" && dot.slackUserId
      ? `Tell ${dot.owner} in Slack: post_to_slack to channel ${dot.slackUserId}, then say so here.`
      : `Tell ${dot.owner} in your reply.`,
  };
  return [...read, ...actionsFor(ctx.agentId).map((action) => reviewed(action, review))];
}
