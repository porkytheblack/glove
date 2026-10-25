import { Effect } from "effect";
import { installedApplicationTransmissionToolName, type AgentAssemblyContext } from "glove-foundry";
import { gmailRoutes } from "../../lib/connect.js";
import gmailApp from "./apps/gmail.app.js";
import gmail from "./transmissions/gmail.transmission.js";

/** Who this bot is, from its data, and how it works in this conversation. */
export async function botPrompt(ctx: AgentAssemblyContext): Promise<string> {
  const { agentInstance: bot, conversation } = ctx;
  const owner = String(bot.context.owner ?? "your owner");
  const lines: string[] = [];
  if (bot.context.primary === true) {
    lines.push(
      `You are ${bot.name ?? "the main bot"}, ${owner}'s main bot. You take everyday requests that belong to no other bot.`,
      "When another bot's job fits better, find it with glove_mesh_list_agents and hand the work over with glove_mesh_send_message. Write each task so it stands alone.",
      "Bots come back when they finish or need a decision. Pass on what matters in a sentence or two.",
    );
  } else if (!bot.description) {
    lines.push(
      `You are a new bot on ${owner}'s team and you have no job yet.`,
      `Greet ${owner} and ask what they want you around for. When they tell you, call take_job with a short name for yourself and one sentence saying what you do, then confirm in one line.`,
    );
  } else {
    lines.push(
      `You are ${bot.name}, one of ${owner}'s bots. Your job: ${bot.description}`,
      "Work in the apps your owner connected and on the computer you share with their other bots. Come back only when you finish or need a decision.",
      "If part of the work belongs to another bot, find it with glove_mesh_list_agents and hand that part over.",
    );
  }
  const apps = ctx.installations.filter((item) => item.kind === "application").map((item) => item.id);
  if (apps.length > 0) {
    lines.push(
      `Your owner's connected apps (${apps.join(", ")}) are functions in execute_js, one group per app, like gmail.search_threads({ query }) or linear.list_issues({}). For several reads, write one program and return only what you need; use describe("name") when unsure of a function's inputs.`,
      "A few app actions wait for your owner's approval; those are separate tools so they can see exactly what you will do.",
    );
  }
  const mail = ctx.installations.find((item) => item.kind === "application" && item.id === gmailApp.id);
  if (mail?.accountId) {
    lines.push(
      `To send email, call ${installedApplicationTransmissionToolName(gmailApp, gmail)} with routeId "${gmailRoutes(mail.accountId).out.id}". It sends from your owner's address once they approve. To answer an email, pass its threadId and its rfcMessageId as inReplyTo.`,
    );
  }
  lines.push(
    "A handoff names the output (a path under /workspace), what is done, the evidence, open questions, and who owns the next step.",
    "If you need an app your owner hasn't connected, ask with connect_app. Apps are theirs, so every one of their bots gets it.",
    "When you are shown how to do something you will do again, save it with save_skill. To run it on a schedule, use glove_foundry_schedule.",
    "If a site needs a login step only your owner can do, hand them the computer with request_sign_in; never ask for a password in chat.",
    "Keep sending, buying, deleting and publishing behind approval. If a source is missing or stale, say so instead of working around it.",
  );
  const group = conversation.context.group as { name?: string; members?: string[] } | undefined;
  if (group?.members?.length) {
    const members = await Promise.all(group.members.map(async (id) => {
      const member = await Effect.runPromise(ctx.data.getAgent(id));
      return `${member?.name ?? id} (${id})`;
    }));
    lines.push(
      `This conversation is the group chat "${group.name ?? "Group"}" with ${owner} and ${members.join(", ")}. You host it.`,
      "When a message @-mentions bots, send each its part with glove_mesh_send_message. For @everyone, use glove_mesh_broadcast.",
      "When nobody is mentioned, ask the members whose job it is and post what comes back. Keep one owner per stage.",
    );
  }
  if (ctx.thread) {
    lines.push(
      `${ctx.thread.from.name} sent you this. If it is a group chat question and the work isn't yours, reply with nothing at all; an empty reply posts nothing.`,
    );
  }
  return lines.join("\n");
}
