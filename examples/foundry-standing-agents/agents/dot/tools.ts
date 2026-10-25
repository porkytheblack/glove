import type { GloveFoldArgs, IGloveRunnable } from "glove-core";
import { installedApplicationTransmissionToolName, type AgentAssemblyContext } from "glove-foundry";
import { actionsFor } from "../../lib/actions.js";
import { reviewed, type Review } from "../../lib/auto-review.js";
import { currentDot, type ParsedDot } from "../../lib/dot.js";
import { knownContacts, researchTools } from "../../lib/sources.js";
import { aroundTool } from "../../lib/tool-policy.js";
import gmailApp from "./apps/gmail.app.js";
import { readOnly } from "./research.js";
import gmail from "./transmissions/gmail.transmission.js";

function reviewOf(dot: ParsedDot, contacts: ReadonlyArray<string>): Review {
  return {
    owner: dot.owner,
    rules: dot.rules,
    contacts: [...contacts],
    tellPerson: dot.routing.decisions === "slack" && dot.slackUserId
      ? `Tell ${dot.owner} in Slack: post_to_slack to channel ${dot.slackUserId}, then say so here.`
      : `Tell ${dot.owner} in your reply.`,
  };
}

/**
 * Runs on the dot's own time (research, new mail, wake-ups, spawned work) get
 * the read-only tools and nothing else: the acting tools are absent, not
 * refused. Other runs also get the acting tools, each wrapped by auto-review.
 */
export async function dotTools(ctx: AgentAssemblyContext): Promise<GloveFoldArgs<any>[]> {
  const read = researchTools(ctx.agentId);
  if (readOnly(ctx.request)) return read;
  const review = reviewOf(await currentDot(ctx), []);
  return [...read, ...actionsFor(ctx.agentId).map((action) => reviewed(action, review))];
}

interface Send { readonly routeId: string; readonly payload: { readonly to: string; readonly subject: string } }

/**
 * The Gmail app's send, under the same auto-review as every other action:
 * the rule send_email decides, and an address that never wrote in always
 * asks. Foundry still delivers it in its own process with the mailbox's
 * session. On runs the dot starts itself, it is removed.
 */
export async function reviewSends(agent: IGloveRunnable, ctx: Pick<AgentAssemblyContext, "agentId" | "agentInstance" | "data" | "request">): Promise<void> {
  const name = installedApplicationTransmissionToolName(gmailApp, gmail);
  if (readOnly(ctx.request)) return aroundTool(agent, name, () => undefined);
  const review = reviewOf(await currentDot(ctx), await knownContacts(agent));
  aroundTool(agent, name, (send) => reviewed<Send>({
    name: send.name,
    description: "Send an email from the mailbox you work from: a reply (pass threadId and inReplyTo) or a new message.",
    jsonSchema: send.jsonSchema,
    rule: "send_email",
    recipient: (input) => input.payload.to,
    handOff: (input) => `Send "${input.payload.subject}" to ${input.payload.to} yourself.`,
    do: (input, _display, _glove, signal) => send.run(input, signal),
  }, review));
}
