import type { ModelAdapter } from "glove-core";
import { createAdapter } from "glove-core/models/providers";
import type { AgentAssemblyContext, AgentInstance } from "glove-foundry";
import { DemoModel, meshAttribute, meshBody, type DemoStep, type DemoTurn } from "./demo-model.js";

// The model comes from the bot's data, like everything else: the main bot
// takes everyday requests and routes work, so it stays quick; the other bots
// do the work and can be slower and stronger. Without ANTHROPIC_API_KEY every bot runs a short
// script, so `pnpm verify` and `pnpm dev` work offline. On Kuiper,
// ANTHROPIC_BASE_URL points the same adapter at the model gateway.

function scripted(): boolean {
  return process.env.CREW_DEMO === "1" || !process.env.ANTHROPIC_API_KEY;
}

export function botModel(_agent: unknown, { agentInstance: bot }: AgentAssemblyContext): ModelAdapter {
  const main = bot.context.primary === true;
  if (scripted()) return new DemoModel(bot.id, scriptFor(bot));
  const model = main
    ? process.env.MAIN_BOT_MODEL ?? "claude-haiku-5-5"
    : process.env.BOT_MODEL ?? "claude-sonnet-5-5";
  const baseURL = process.env.ANTHROPIC_BASE_URL;
  return createAdapter({ provider: "anthropic", model, stream: true, ...(baseURL ? { baseURL } : {}) });
}

// ── The scripts ─────────────────────────────────────────────────────────────
// Picked by the bot's data, the way a real model would read its prompt.

const say = (text: string): DemoStep => ({ say: text });
const call = (tool: string, input: Record<string, unknown>): DemoStep => ({ call: tool, input });
const count = (called: ReadonlyArray<string>, tool: string) => called.filter((name) => name === tool).length;

/** The id of a teammate by name, from a glove_mesh_list_agents result. */
function idOf(results: ReadonlyArray<string>, name: string): string | undefined {
  for (const result of results) {
    const agents = (JSON.parse(result) as { data?: { agents?: Array<{ id: string; name: string }> } }).data?.agents;
    const match = agents?.find((agent) => agent.name === name);
    if (match) return match.id;
  }
  return undefined;
}

function scriptFor(bot: AgentInstance): (turn: DemoTurn) => DemoStep {
  if (bot.context.primary === true) return mainScript;
  if (!bot.description) return newBotScript;
  if (bot.name === "Sales Outbound") return salesScript;
  if (bot.name === "Bug Triage") return bugTriageScript;
  return () => say("Patched on branch fix/empty-export: export returns an empty file for an empty report. Added a test.");
}

function mainScript({ text, called, results }: DemoTurn): DemoStep {
  if (text.startsWith("<mesh-message")) {
    if (/status="(replied|failed)"/.test(text)) return say(`${meshAttribute(text, "name")}: ${meshBody(text)}`);
    return call("glove_mesh_send_message", { to: meshAttribute(text, "from"), in_reply_to: meshAttribute(text, "id"), content: "Use the main branch." });
  }
  // A group chat it hosts: everyone, or each @-mentioned bot its part.
  if (/@everyone\b/.test(text)) {
    if (!called.includes("glove_mesh_broadcast")) return call("glove_mesh_broadcast", { content: text.replace(/@everyone\s*/, "") });
    return say("Asked everyone. Answers will land here.");
  }
  const mentions = [...text.matchAll(/@([A-Z][a-z]+(?: [A-Z][a-z]+)*)\s+([^@]+)/g)].map((match) => ({ name: match[1]!, ask: match[2]!.trim() }));
  if (mentions.length > 0) {
    if (!called.includes("glove_mesh_list_agents")) return call("glove_mesh_list_agents", {});
    const next = mentions[count(called, "glove_mesh_send_message")];
    if (next) return call("glove_mesh_send_message", { to: idOf(results, next.name) ?? next.name, content: next.ask });
    return say(`Asked ${mentions.map((mention) => mention.name).join(" and ")}. Their answers will land here.`);
  }
  const fromX = text.includes('<transmission direction="inbound"');
  if (fromX || /crash|bug|broken/i.test(text)) {
    const tweetId = /tweetId&quot;:&quot;([^&]+)&quot;/.exec(text)?.[1];
    if (fromX && !called.includes("reply_on_x")) {
      return call("reply_on_x", { inReplyTo: tweetId ?? "", text: "On it. Bug Triage has this; results will be in your main thread." });
    }
    if (!called.includes("glove_mesh_list_agents")) return call("glove_mesh_list_agents", {});
    if (!called.includes("glove_mesh_send_message")) {
      return call("glove_mesh_send_message", {
        to: idOf(results, "Bug Triage") ?? "",
        content: "Reproduce and fix: the export button crashes on empty reports.",
      });
    }
    return say("Bug Triage has it. I'll tell you when it's fixed.");
  }
  return say("Noted.");
}

function newBotScript({ called }: DemoTurn): DemoStep {
  if (!called.includes("take_job")) {
    return call("take_job", {
      name: "Sales Outbound",
      description: "Overnight pipeline generation and outbound: picks prospects from the signups sheet, researches them and drafts emails in Maya's voice.",
    });
  }
  return say("Renamed to Sales Outbound. I'll start on tonight's batch.");
}

function salesScript({ text, called, lastResult }: DemoTurn): DemoStep {
  if (text.startsWith("<mesh-message")) return say("14 new leads this week, 9 intros drafted and waiting for you.");
  if (/every monday/i.test(text)) {
    if (!called.includes("save_skill")) {
      return call("save_skill", {
        name: "monday-signups",
        description: "Sweep last week's signups and draft an intro for each.",
        steps: "1. Read the signups sheet for the past 7 days.\n2. Skip anyone already emailed.\n3. Draft a two-line intro for each and queue it for approval.",
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
    return say(/"signedIn":true/.test(lastResult) ? "Signed in to Salesforce. 12 open deals pulled." : "No sign-in yet, so I left Salesforce alone.");
  }
  if (!called.includes("draft_email")) {
    return call("draft_email", { to: "dana@example.com", subject: "Quick intro", body: "Hi Dana, our export API could save your team a day a week. Fifteen minutes this week?" });
  }
  if (!called.includes("send_email")) return call("send_email", { draftId: /"draftId":"([^"]+)"/.exec(lastResult)?.[1] ?? "" });
  return say(/"sent":true/.test(lastResult) ? "Sent the intro to dana@example.com." : "You didn't approve it, so nothing went out.");
}

function bugTriageScript({ text, called, results, lastResult }: DemoTurn): DemoStep {
  if (/connect|tracker/i.test(text) && !text.startsWith("<mesh-message")) {
    if (!called.includes("connect_app")) return call("connect_app", { app: "tickets", why: "To file and track the bugs I triage." });
    return say(/"connected":"tickets"/.test(lastResult) ? "The ticket tracker is connected for all your bots." : "Not connected, so I'll keep bugs in notes for now.");
  }
  if (!/crash/i.test(text)) return say("Nothing blocking. One bug this week, T-1, and Engineer has fixed it.");
  if (!called.includes("file_ticket")) {
    return call("file_ticket", {
      title: "Export crashes on an empty report",
      steps: ["Open an empty report", "Click Export", "The page throws: cannot read rows of undefined"],
    });
  }
  if (!called.includes("glove_mesh_list_agents")) return call("glove_mesh_list_agents", {});
  if (!called.includes("glove_mesh_send_message")) {
    const ticket = /"ticket":"([^"]+)"/.exec(results.join(""))?.[1] ?? "the ticket";
    return call("glove_mesh_send_message", {
      to: idOf(results, "Engineer") ?? "",
      content: `Fix ${ticket}: export crashes on an empty report. Steps are on the ticket.`,
      blocking: true,
    });
  }
  const reply = /"reply":"([^"]+)"/.exec(lastResult)?.[1];
  return say(reply ? `Fixed: ${reply}` : "Filed it and handed it to Engineer.");
}
