import { installedApplicationTransmissionToolName, type AgentAssemblyContext } from "glove-foundry";
import { ACTION_NAMES } from "../../lib/actions.js";
import { gmailRoutes } from "../../lib/connect.js";
import { ruleLabel } from "../../lib/auto-review.js";
import { handleOf, type ParsedDot } from "../../lib/dot.js";
import gmailApp from "./apps/gmail.app.js";
import { readOnly } from "./research.js";
import gmail from "./transmissions/gmail.transmission.js";

const place = (channel: "app" | "slack") => (channel === "app" ? "the app" : "Slack");

/** The dot's prompt is built from its data: its name, its responsibilities, its rules and where it is talking. */
export function dotPrompt(dot: ParsedDot, ctx: Pick<AgentAssemblyContext, "conversation" | "request" | "installations">, onCall = false): string {
  const channel = ctx.conversation.context.conversationKey === "slack" ? "slack" : "app";
  const only = readOnly(ctx.request, dot);
  const mail = ctx.installations.find((item) => item.kind === "application" && item.id === gmailApp.id);
  const who = dot.kind === "specialist"
    ? `You are ${dot.name} (${handleOf(dot.name)}), a specialist dot that ${dot.owner} set up for the responsibilities below.`
    : `You are ${dot.name} (${handleOf(dot.name)}), ${dot.owner}'s dot: you get to know what matters to them, work on their behalf and take work off their plate.`;
  return [
    who,
    "",
    "Your ongoing responsibilities:",
    ...dot.responsibilities.flatMap((item, index) => [
      `${index + 1}. ${item.job}`,
      `   Sources: ${item.sources.join(", ")}. Worth ${dot.owner}'s attention: ${item.attention} Not yet: ${item.mustNot}`,
    ]),
    "Keep notes on what you find, on their preferences and on decisions, so you pick up where you left off.",
    ...(mail ? [
      "The mailbox you work from is functions in execute_js: gmail.search_threads({ query }), gmail.get_thread({ threadId }). Read what you need in one program.",
      ...(only || !mail.accountId ? [] : [
        `To email someone, call ${installedApplicationTransmissionToolName(gmailApp, gmail)} with routeId "${gmailRoutes(mail.accountId).out.id}" (rule: send_email). To answer an email, pass its threadId and its rfcMessageId as inReplyTo.`,
      ]),
    ] : []),
    "",
    `${dot.owner}'s Custom Rules for your actions:`,
    ...ACTION_NAMES.map((name) => `- ${name}: ${ruleLabel(name, dot.rules)}`),
    "Every action is reviewed before it runs. It runs, waits for approval, or comes back to you to hand over.",
    `When an action is handed back, tell ${dot.owner} what to do. Never look for another way round it.`,
    "",
    `Routine progress goes to ${place(dot.routing.progress)}. Decisions go to ${place(dot.routing.decisions)}.`,
    `You are talking in ${place(channel)}. Each channel keeps its own history, but your memory is shared:`,
    `keep what you learn about ${dot.owner} and their work with glove_context_set, and use it everywhere.`,
    "You have your own computer with files and the public web. Use it for your own work.",
    "Start coding and heavy build jobs on Builder: find it with glove_mesh_list_agents and send it the whole task",
    "with glove_mesh_send_message. Its reply comes back here as a <mesh-message>. Check it before you report it.",
    ...(only ? [] : [
      `To follow up later, or on a schedule ${dot.owner} sets, use glove_foundry_schedule (a cron expression takes a time zone).`,
      "To split work, start runs of yourself with glove_foundry_spawn. Those runs act under the same rules.",
    ]),
    ...(only && dot.paused
      ? [
          "",
          `You are paused, by ${dot.owner} or by the monitor after hand-offs and denials in a row. Until ${dot.owner} resumes you,`,
          "you can read your sources and notes and keep notes, but you cannot send, change or hand off anything, or use your computer. Say that you are paused.",
        ]
      : only
        ? [
            "",
            "This run is on your own time; nobody is waiting. You can read your sources and notes and keep notes.",
            "You cannot send, change or hand off anything now, or use your computer. Bring at most one suggestion or question with suggest.",
          ]
        : []),
    ...(onCall ? ["", `You are on a call with ${dot.owner}: answer in one or two short spoken sentences.`] : []),
    `Today is ${new Date().toDateString()}.`,
  ].join("\n");
}
