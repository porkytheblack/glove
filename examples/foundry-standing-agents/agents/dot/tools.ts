import type { GloveFoldArgs, IGloveRunnable } from "glove-core";
import { installedApplicationTransmissionToolName, type AgentAssemblyContext } from "glove-foundry";
import { ACTION_NAMES, actionsFor } from "../../lib/actions.js";
import { reviewed, type Review } from "../../lib/auto-review.js";
import { currentDot, type ParsedDot } from "../../lib/dot.js";
import { knownContacts, researchTools } from "../../lib/sources.js";
import { aroundTool } from "../../lib/tool-policy.js";
import gmailApp, { GMAIL_READS } from "./apps/gmail.app.js";
import { followUps, readOnly, startedByPerson } from "./research.js";
import gmail from "./transmissions/gmail.transmission.js";

type Context = Pick<AgentAssemblyContext, "agentId" | "agentInstance" | "data" | "request">;

const sendTool = () => installedApplicationTransmissionToolName(gmailApp, gmail);

/** The tools auto-review wraps. The monitor watches how they end (lib/monitor.ts). */
export const reviewedTools = (): ReadonlySet<string> => new Set([...ACTION_NAMES, sendTool()]);

function reviewOf(dot: ParsedDot, contacts: ReadonlyArray<string>, request: Context["request"]): Review {
  return {
    owner: dot.owner,
    rules: dot.rules,
    askedByPerson: startedByPerson(request),
    contacts: [...contacts],
    tellPerson: dot.routing.decisions === "slack" && dot.slackUserId
      ? `Tell ${dot.owner} in Slack: post_to_slack to channel ${dot.slackUserId}, then say so here.`
      : `Tell ${dot.owner} in your reply.`,
  };
}

/**
 * Read-only runs (research, new mail, wake-ups, and every run of a paused
 * dot) get the read-only tools and nothing else: the acting tools are absent,
 * not refused. Other runs also get the acting tools, each wrapped by
 * auto-review.
 */
export async function dotTools(ctx: Context): Promise<GloveFoldArgs<any>[]> {
  const read = researchTools(ctx.agentId);
  const dot = await currentDot(ctx);
  if (readOnly(ctx.request, dot)) return read;
  const review = reviewOf(dot, [], ctx.request);
  return [...read, ...actionsFor(ctx.agentId).map((action) => reviewed(action, review))];
}

/**
 * The rest of the dot's tools, with the dot read fresh (a recurring schedule
 * carries the instance it was armed with). Gmail's send goes under auto-review
 * and runs the dot starts become follow-ups; on a read-only run neither is
 * there. A paused dot also loses what the person starting the run mounted:
 * Slack's post, the mailbox's writes and the mesh.
 */
export async function configureDot(agent: IGloveRunnable, ctx: Context): Promise<void> {
  const dot = await currentDot(ctx);
  if (dot.paused) {
    agent.replaceTools(agent.tools.map((tool) => tool.name).filter((name) =>
      name === "post_to_slack" || name.startsWith("glove_mesh_")
      || (name.startsWith(`${gmailApp.id}__`) && !GMAIL_READS.includes(name.slice(gmailApp.id.length + 2)))), []);
  }
  await reviewSends(agent, ctx, dot);
  followUps(agent, ctx.agentId, !readOnly(ctx.request, dot));
}

interface Send { readonly routeId: string; readonly payload: { readonly to: string; readonly subject: string } }

/**
 * The Gmail app's send, under the same auto-review as every other action:
 * the rule send_email decides, and an address that never wrote in always
 * asks. Foundry still delivers it in its own process with the mailbox's
 * session. On read-only runs, it is removed.
 */
export async function reviewSends(agent: IGloveRunnable, ctx: Context, dot: ParsedDot): Promise<void> {
  if (readOnly(ctx.request, dot)) return aroundTool(agent, sendTool(), () => undefined);
  const review = reviewOf(dot, await knownContacts(agent), ctx.request);
  aroundTool(agent, sendTool(), (send) => reviewed<Send>({
    name: send.name,
    description: "Send an email from the mailbox you work from: a reply (pass threadId and inReplyTo) or a new message.",
    jsonSchema: send.jsonSchema,
    rule: "send_email",
    recipient: (input) => input.payload.to,
    handOff: (input) => `Send "${input.payload.subject}" to ${input.payload.to} yourself.`,
    do: (input, _display, _glove, signal) => send.run(input, signal),
  }, review));
}
