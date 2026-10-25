import { installedApplicationTransmissionToolName } from "glove-foundry";
import gmailApp from "../agents/dot/apps/gmail.app.js";
import gmail from "../agents/dot/transmissions/gmail.transmission.js";
import { gmailRoutes } from "./connect.js";
import { inboundEvent, meshAttribute, meshBody, resultMessage, type DemoStep, type DemoTurn } from "./demo-model.js";

// What the scripted models do when there is no API key. Each script answers
// one kind of message the way a real model would, so `pnpm verify` can drive
// the whole example offline.

const say = (text: string): DemoStep => ({ say: text });
const call = (tool: string, input: Record<string, unknown>): DemoStep => ({ call: tool, input });

const SUGGESTION =
  "CSV export times out on large reports: 4 reports this week (2 in #feedback, 2 by email, from Acme and Globex). Want me to open a draft PR for it?";

const sendTool = () => installedApplicationTransmissionToolName(gmailApp, gmail);

export function dotScript(person: string, { text, called, lastResult, results, context }: DemoTurn): DemoStep {
  if (text.startsWith("Research time")) return research(called);
  // New mail (a Gmail event has an rfcMessageId); otherwise a Slack message.
  if (text.includes('<transmission direction="inbound"') && text.includes("rfcMessageId")) return newMail(text, called);
  if (text.includes('<transmission direction="inbound"')) return inSlack(text, called, context);
  // Builder's reply to a job this dot sent it.
  if (text.startsWith("<mesh-message") && meshAttribute(text, "status") === "replied") {
    return say(`The builder finished. ${meshBody(text)}`);
  }
  if (/\bremember\b/i.test(text)) {
    if (!called.includes("glove_context_set")) {
      const fact = text.replace(/^.*?\bremember( that)?\s*/i, "");
      return call("glove_context_set", { section: "people", content: fact.charAt(0).toUpperCase() + fact.slice(1) });
    }
    return say("Got it. I'll remember that everywhere we talk.");
  }
  if (/\breply to\b/i.test(text)) {
    const to = /[\w.+-]+@[\w-]+(\.[\w-]+)+/.exec(text)?.[0] ?? "";
    if (!called.includes(sendTool())) {
      return call(sendTool(), {
        routeId: gmailRoutes(`${person}-gmail`).out.id,
        payload: { to, subject: "Re: CSV export never finishes", body: "Hi, a fix for large CSV exports ships on Friday. Thanks for your patience.", threadId: "t-1031" },
      });
    }
    return say(/"messageId"/.test(lastResult) ? `Sent the reply to ${to}.` : `I didn't send it. ${resultMessage(lastResult)}`);
  }
  if (/\bmerge\b/i.test(text)) return handOff("merge_pr", { pr: Number(/#(\d+)/.exec(text)?.[1] ?? 42) }, called, lastResult);
  if (/\bpassword\b/i.test(text)) return handOff("change_password", { account: "the support inbox" }, called, lastResult);
  if (/\bdraft pr\b/i.test(text)) {
    if (!called.includes("open_draft_pr")) {
      return call("open_draft_pr", { title: "Stream large CSV exports", branch: "fix/csv-export-timeout" });
    }
    const pr = /"pr":(\d+)/.exec(lastResult)?.[1];
    return say(pr ? `Opened draft PR #${pr}: Stream large CSV exports.` : `Not opened. ${resultMessage(lastResult)}`);
  }
  if (/\bon your computer\b/i.test(text)) {
    if (!called.includes("write_file")) {
      return call("write_file", {
        path: "/workspace/feedback-this-week.md",
        content: "# Feedback this week\n\n- CSV export timeouts: 4\n- Dark mode: 2\n- Safari login loop: 1, unconfirmed\n",
      });
    }
    return say(/"status":"success"/.test(lastResult)
      ? "Saved /workspace/feedback-this-week.md on my computer."
      : `I couldn't save it. ${resultMessage(lastResult)}`);
  }
  if (/\b(build|report)\b/i.test(text)) {
    if (!called.includes("glove_mesh_list_agents")) return call("glove_mesh_list_agents", {});
    if (!called.includes("glove_mesh_send_message")) {
      const builder = (JSON.parse(results[0] ?? "{}") as { data?: { agents?: Array<{ id: string; name: string }> } })
        .data?.agents?.find((agent) => agent.name === "Builder")?.id ?? "";
      return call("glove_mesh_send_message", {
        to: builder,
        content: `${text} Group this week's reports: CSV export timeouts (4), dark mode (2), Safari login loop (1, unconfirmed).`,
      });
    }
    return say("The builder is on it. I'll check what comes back and report here.");
  }
  return say("Got it. I'll watch my sources, group what comes in, and bring you what matters.");
}

/** A research run: read, keep notes, suggest one thing. */
function research(called: ReadonlyArray<string>): DemoStep {
  if (!called.includes("read_channel")) return call("read_channel", { channel: "#feedback" });
  // The mailbox, read in code over the Gmail app.
  if (!called.includes("execute_js")) {
    return call("execute_js", { code: 'gmail.search_threads({ query: "in:inbox" }).threads.map((thread) => `${thread.latest.from}: ${thread.latest.subject}`)' });
  }
  if (!called.includes("keep_note")) {
    return call("keep_note", {
      note: "CSV export timeouts on large reports: 4 (2 in #feedback, 2 by email). Dark mode: 2 asks. Safari login loop: 1, unconfirmed.",
    });
  }
  // A model may reach for an action while researching. It isn't mounted, so the call finds nothing.
  if (!called.includes(sendTool())) {
    return call(sendTool(), { routeId: "", payload: { to: "dana@acme.test", subject: "Re: CSV export", body: "Thanks, we're looking into the export." } });
  }
  if (!called.includes("suggest")) return call("suggest", { text: SUGGESTION });
  return say(SUGGESTION);
}

/** New mail is a read-only run: note it and say what it is. */
function newMail(text: string, called: ReadonlyArray<string>): DemoStep {
  const field = (name: string) => (new RegExp(`${name}&quot;:&quot;(.*?)&quot;`).exec(text)?.[1] ?? "");
  if (!called.includes("keep_note")) {
    return call("keep_note", { note: `New mail from ${field("from")}: ${field("subject")}. Another CSV export report.` });
  }
  return say(`New mail from ${field("from")} about the CSV export; noted with the other reports.`);
}

/** A Slack message from the owner: answer there, with what the dot remembers from the app. */
function inSlack(text: string, called: ReadonlyArray<string>, context: string): DemoStep {
  if (called.includes("post_to_slack")) return say("Answered in Slack.");
  const event = inboundEvent<{ ts: string; channel: string; text: string; thread_ts: string | null }>(text);
  if (!event) return say("I couldn't read that Slack message.");
  const remembered = /billing questions go to [^.\n]+\./i.exec(context)?.[0];
  return call("post_to_slack", {
    channel: event.channel,
    text: /billing/i.test(event.text) && remembered ? `From the app: ${remembered}` : "Noted. I'll keep it with the feedback I track.",
    // A mention in a channel is answered in its thread; a DM is answered in the DM.
    ...(event.channel.startsWith("D") ? {} : { thread_ts: event.thread_ts ?? event.ts }),
  });
}

/** Try an action; if auto-review hands it off, tell the person where their routing says. */
function handOff(tool: string, input: Record<string, unknown>, called: ReadonlyArray<string>, lastResult: string): DemoStep {
  if (!called.includes(tool)) return call(tool, input);
  if (called.at(-1) === tool) {
    const message = resultMessage(lastResult);
    if (!message.startsWith("Auto-review")) return say(`Done: ${tool}.`);
    const channel = /post_to_slack to channel ([^,\s]+)/.exec(message)?.[1];
    const todo = /It stays with [^.]+\. (.*?) Tell /.exec(message)?.[1] ?? message;
    if (channel) return call("post_to_slack", { channel, text: `Over to you: ${todo}` });
    return say(`That one is yours. ${todo}`);
  }
  return say("That one is yours, so I didn't do it. The details are in Slack.");
}

export function builderScript({ called, lastResult }: DemoTurn): DemoStep {
  if (!called.includes("write_file")) {
    return call("write_file", {
      path: "/out/weekly-feedback.md",
      content: [
        "# Weekly feedback",
        "",
        "1. CSV export times out on large reports: 4 reports (Acme, Globex, two in #feedback).",
        "2. Dark mode: 2 asks (prospects, Initech).",
        "3. Safari login loop: 1 report, not reproduced.",
      ].join("\n"),
    });
  }
  return say(/"status":"success"/.test(lastResult)
    ? "Wrote /out/weekly-feedback.md: CSV export timeouts lead with 4 reports, then dark mode (2) and the Safari login loop (1, unconfirmed)."
    : `Could not write the report. ${resultMessage(lastResult)}`);
}
