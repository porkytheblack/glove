import type { ModelAdapter } from "glove-core";
import { createAdapter } from "glove-core/models/providers";
import type { AgentAssemblyContext, AgentInstance } from "glove-foundry";
import gmailApp from "../agents/bot/apps/gmail.app.js";
import gmail from "../agents/bot/transmissions/gmail.transmission.js";
import { installedApplicationTransmissionToolName } from "glove-foundry";
import { gmailRoutes } from "./connect.js";
import { DemoModel, type DemoStep, type DemoTurn } from "./demo-model.js";

// Every bot uses the same model; which bot it is comes from its data. Without
// ANTHROPIC_API_KEY every bot runs a short script picked by its data, so
// `pnpm verify` and `pnpm dev` work offline. On Kuiper, ANTHROPIC_BASE_URL
// points the same adapter at the model gateway.

function scripted(): boolean {
  return process.env.CREW_DEMO === "1" || !process.env.ANTHROPIC_API_KEY;
}

export function botModel(_agent: unknown, { agentInstance: bot }: AgentAssemblyContext): ModelAdapter {
  if (scripted()) return new DemoModel(bot.id, scriptFor(bot));
  const baseURL = process.env.ANTHROPIC_BASE_URL;
  return createAdapter({ provider: "anthropic", model: process.env.BOT_MODEL ?? "claude-sonnet-5-5", stream: true, ...(baseURL ? { baseURL } : {}) });
}

// ── The scripts ─────────────────────────────────────────────────────────────
// Picked by the bot's data, the way a real model would read its prompt.

const say = (text: string): DemoStep => ({ say: text });
const call = (tool: string, input: Record<string, unknown>): DemoStep => ({ call: tool, input });

/** The id of a teammate by name, from a glove_mesh_list_agents result. */
function idOf(results: ReadonlyArray<string>, name: string): string | undefined {
  for (const result of results) {
    const agents = (JSON.parse(result) as { data?: { agents?: Array<{ id: string; name: string }> } }).data?.agents;
    const match = agents?.find((agent) => agent.name === name);
    if (match) return match.id;
  }
  return undefined;
}

/** A field of the Gmail event in a serialized inbound transmission. */
const mailField = (text: string, name: string) => (new RegExp(`${name}&quot;:&quot;(.*?)&quot;`).exec(text)?.[1] ?? "")
  .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");

/** The Gmail send tool and the route it sends through, for this bot's owner. */
function sendMail(bot: AgentInstance, payload: Record<string, string>): DemoStep {
  return call(installedApplicationTransmissionToolName(gmailApp, gmail), {
    routeId: gmailRoutes(`${bot.workspaceId}-gmail`).out.id,
    payload,
  });
}
const sendTool = () => installedApplicationTransmissionToolName(gmailApp, gmail);

function scriptFor(bot: AgentInstance): (turn: DemoTurn) => DemoStep {
  if (!bot.description) return newBotScript;
  if (bot.name === "Inbox Manager") return (turn) => inboxScript(bot, turn);
  if (bot.name === "Sales Outbound") return (turn) => salesScript(bot, turn);
  if (bot.name === "Bug Triage") return bugTriageScript;
  return ({ text }) => say(/^hi\b/i.test(text) ? "Hi Maya." : "Patched on branch fix/empty-export: export returns an empty file for an empty report. Added a test.");
}

function inboxScript(bot: AgentInstance, { text, called, results, lastResult }: DemoTurn): DemoStep {
  // New mail, through its routine: answer it from Maya's address.
  if (text.includes('<transmission direction="inbound"')) {
    const from = mailField(text, "from");
    if (!called.includes(sendTool())) {
      return sendMail(bot, {
        to: /<([^>]+)>/.exec(from)?.[1] ?? from,
        subject: `Re: ${mailField(text, "subject")}`,
        body: "Hi Lena, for a team of 40 the export API is on the Team plan. I've asked for a quote to be sent today.",
        threadId: mailField(text, "threadId"),
        inReplyTo: mailField(text, "rfcMessageId"),
      });
    }
    return say(/"messageId"/.test(lastResult) ? `Replied to ${from.replace(/\s*<.*/, "")} about pricing.` : "You didn't approve the reply, so nothing went out.");
  }
  // A saved skill, invoked by name: its steps arrive just before this message.
  const skill = /\[invoked_extension__skill_([\w-]+)\]/.exec(text)?.[1];
  if (skill) return say(`Running ${skill} from the steps you saved.`);
  // An ask that named no bot came to it, the starred one: its part, and the sales part to Sales Outbound.
  if (/this week/i.test(text)) {
    if (!called.includes("glove_mesh_list_agents")) return call("glove_mesh_list_agents", {});
    if (!called.includes("glove_mesh_send_message")) {
      return call("glove_mesh_send_message", { to: idOf(results, "Sales Outbound") ?? "", content: "How many leads this week?", blocking: true });
    }
    const reply = /"reply":"([^"]+)"/.exec(lastResult)?.[1];
    return say(`Inbox is clear. Sales Outbound says: ${reply ?? "no answer yet."}`);
  }
  return say("Hi Maya. I'm watching your inbox and will answer what I can from your address.");
}

function newBotScript({ called }: DemoTurn): DemoStep {
  if (!called.includes("take_job")) {
    return call("take_job", {
      name: "Sales Outbound",
      description: "Overnight pipeline generation and outbound: picks prospects from the signup emails, researches them and drafts emails in Maya's voice.",
      style: "Two-line intros, no hype. Checks with Maya before anything goes out.",
    });
  }
  return say("Renamed to Sales Outbound. I'll start on tonight's batch.");
}

function salesScript(bot: AgentInstance, { text, called, lastResult }: DemoTurn): DemoStep {
  // Mentioned in a group chat, or asked by a sibling: answer its own part.
  if (/@Sales Outbound\b/.test(text) || text.startsWith("<mesh-message")) return say("14 new leads this week, 9 intros drafted and waiting for you.");
  if (/every monday/i.test(text)) {
    if (!called.includes("save_skill")) {
      return call("save_skill", {
        name: "monday-signups",
        description: "Sweep last week's signups and draft an intro for each.",
        steps: "1. Search Gmail for signup emails from the past 7 days.\n2. Skip anyone already emailed.\n3. Draft a two-line intro for each and queue it for approval.",
      });
    }
    if (!called.includes("glove_foundry_schedule")) {
      return call("glove_foundry_schedule", {
        message: "Run the monday-signups skill. Read it with glove_read_skill first.",
        timing: { kind: "cron", expression: "0 9 * * 1" },
      });
    }
    return say("Saved monday-signups. It runs every Monday at 09:00.");
  }
  if (/sign in/i.test(text)) {
    if (!called.includes("request_sign_in")) {
      return call("request_sign_in", { site: "Salesforce", url: "https://login.salesforce.com", why: "To pull the open deals." });
    }
    return say(/"approved":true/.test(lastResult) ? "You approved the Salesforce sign-in, but I have no browser here to sign in with, so I left Salesforce alone." : "No sign-in yet, so I left Salesforce alone.");
  }
  // Reads happen in code over the Gmail app; the send is a direct tool so Maya approves it.
  if (!called.includes("execute_js")) {
    return call("execute_js", {
      code: 'const found = gmail.search_threads({ query: "subject:signup" }); found.threads.map((thread) => thread.latest.subject)',
    });
  }
  if (!called.includes(sendTool())) {
    if (!/Dana Lee/.test(lastResult)) return say("No signup from Dana in your inbox, so I sent nothing.");
    return sendMail(bot, { to: "dana@example.com", subject: "Quick intro", body: "Hi Dana, our export API could save your team a day a week. Fifteen minutes this week?" });
  }
  return say(/"messageId"/.test(lastResult) ? "Sent the intro to dana@example.com." : "You didn't approve it, so nothing went out.");
}

function bugTriageScript({ text, called, results, lastResult }: DemoTurn): DemoStep {
  // Its routine on new mail: only bug reports are its job.
  if (text.includes('<transmission direction="inbound"')) {
    return say(/crash|bug|error/i.test(mailField(text, "subject")) ? "Filing the bug from that email." : "Not a bug report, so nothing to file.");
  }
  if (/lands in (my|your) inbox/i.test(text)) {
    if (!called.includes("add_routine")) {
      return call("add_routine", { on: "new-mail", instruction: "If the email reports a bug, reproduce it and file it in Linear. Otherwise do nothing." });
    }
    return say("Done. I'll file bug reports from your inbox as they arrive.");
  }
  if (/connect|linear/i.test(text) && !text.startsWith("<mesh-message")) {
    if (!called.includes("connect_app")) return call("connect_app", { app: "linear", why: "To file and track the bugs I triage." });
    return say(/"connected":"linear"/.test(lastResult) ? "Linear is connected for all your bots." : "Not connected yet, so I'll keep bugs in notes for now.");
  }
  if (!/crash/i.test(text)) return say("Nothing blocking. One bug this week, ENG-1, and Engineer has fixed it.");
  // Filing writes, so it is a tool; Maya always allows it, so it runs without asking.
  if (!called.includes("linear__save_issue")) {
    return call("linear__save_issue", {
      title: "Export crashes on an empty report",
      description: "1. Open an empty report\n2. Click Export\n3. The page throws: cannot read rows of undefined",
    });
  }
  if (!called.includes("glove_mesh_list_agents")) return call("glove_mesh_list_agents", {});
  if (!called.includes("glove_mesh_send_message")) {
    const issue = /"id\\?":\\?"([A-Z]+-\d+)/.exec(results.join(""))?.[1] ?? "the issue";
    return call("glove_mesh_send_message", {
      to: idOf(results, "Engineer") ?? "",
      content: `Fix ${issue}: export crashes on an empty report. Steps are on the issue.`,
      blocking: true,
    });
  }
  const reply = /"reply":"([^"]+)"/.exec(lastResult)?.[1];
  return say(reply ? `Fixed: ${reply}` : "Filed it and handed it to Engineer.");
}
