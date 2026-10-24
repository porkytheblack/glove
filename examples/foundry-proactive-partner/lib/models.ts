import type { ModelAdapter } from "glove-core";
import { createAdapter } from "glove-core/models/providers";
import { s2sDrivenModel } from "glove-voice-s2s";
import { DemoModel, type DemoStep, type DemoTurn } from "./demo-model.js";

// The partner judges what matters, so it gets the strongest model. The computer
// does long jobs and can use the same. Without ANTHROPIC_API_KEY both run a
// scripted model, so `pnpm verify` and `pnpm dev` work offline. On Kuiper,
// ANTHROPIC_BASE_URL points the same adapter at the model gateway.

function scripted(): boolean {
  return process.env.PARTNER_DEMO === "1" || !process.env.ANTHROPIC_API_KEY;
}

export function partnerModel(): ModelAdapter {
  if (scripted()) return new DemoModel("partner", partnerScript);
  return anthropic(process.env.PARTNER_MODEL ?? "claude-opus-5-5");
}

export function computerModel(): ModelAdapter {
  if (scripted()) return new DemoModel("computer", computerScript);
  return anthropic(process.env.COMPUTER_MODEL ?? "claude-sonnet-5-5");
}

/** On a call, a speech-to-speech session drives the turns (OPENAI_API_KEY). */
export function callModel(): ModelAdapter {
  return s2sDrivenModel({ label: "partner-call", provider: "openai", voice: "marin" });
}

function anthropic(model: string): ModelAdapter {
  const baseURL = process.env.ANTHROPIC_BASE_URL;
  return createAdapter({ provider: "anthropic", model, stream: true, ...(baseURL ? { baseURL } : {}) });
}

// ── The scripts ─────────────────────────────────────────────────────────────

const say = (text: string): DemoStep => ({ say: text });
const call = (tool: string, input: Record<string, unknown>): DemoStep => ({ call: tool, input });

function partnerScript({ text, called, lastResult, results }: DemoTurn): DemoStep {
  if (text.startsWith("Morning brief.")) {
    if (!called.includes("read_inbox")) return call("read_inbox", {});
    if (!called.includes("read_calendar")) return call("read_calendar", {});
    const brief = [
      "1. Your 16:30 Northwind call overlaps your 16:00 flight to Austin. Want me to move the call to tomorrow at 10:00?",
      "2. Priya needs your signature on NW-2026-114 by Friday.",
      "3. Leo asks to move lunch to 1:30.",
    ].join("\n");
    if (!called.includes("notify_person")) return call("notify_person", { title: "Morning brief", body: brief });
    return say(brief);
  }
  if (text.startsWith("Check-in.")) {
    if (!called.includes("read_inbox")) return call("read_inbox", {});
    const invoice = /(INV-\d+)/.exec(lastResult)?.[1];
    if (!invoice) return say("(nothing new)");
    if (!called.includes("notify_person")) {
      return call("notify_person", { title: `Payment failed: ${invoice}`, body: `Acme Hosting could not charge your card for ${invoice} ($240, due today). Want me to pay it from your bank account?` });
    }
    return say(`I let you know about ${invoice}. Say "pay it" and I'll queue the payment for your approval.`);
  }
  // The computer's reply: tell the person it is done, then say so here.
  if (text.startsWith("<mesh-message")) {
    const done = /<mesh-message[^>]*>\n([\s\S]*?)\n<\/mesh-message>/.exec(text)?.[1] ?? "";
    if (!called.includes("notify_person")) return call("notify_person", { title: "Your dashboard is ready", body: done });
    return say(`Done: ${done}`);
  }
  if (/move .*money|transfer|savings to checking/i.test(text)) {
    return say("I can't move money between accounts, even with your approval. That one is yours to do in your bank's app.");
  }
  if (/\bpay\b/i.test(text)) {
    if (!called.includes("pay_invoice")) return call("pay_invoice", { invoiceId: "INV-88", payee: "Acme Hosting", amount: 240, currency: "USD" });
    return say(/"paid":true/.test(lastResult) ? "Paid INV-88: $240 to Acme Hosting." : "You declined, so I did not pay INV-88.");
  }
  if (/card number/i.test(text)) {
    if (!called.includes("send_message")) {
      return call("send_message", { to: "Sam", via: "text", text: "Ada's card for the hotel: 4242 4242 4242 4242" });
    }
    return say("I won't send card numbers, even to Sam. I can send him the hotel's booking link instead.");
  }
  if (/\b(build|dashboard)\b/i.test(text)) {
    if (!called.includes("glove_mesh_list_agents")) return call("glove_mesh_list_agents", {});
    if (!called.includes("glove_mesh_send_message")) {
      const computer = (JSON.parse(results[0] ?? "{}") as { data?: { agents?: Array<{ id: string; name: string }> } })
        .data?.agents?.find((agent) => agent.name === "Computer")?.id ?? "";
      return call("glove_mesh_send_message", { to: computer, content: text });
    }
    return say("My computer is on it. I'll let you know when it's ready.");
  }
  return say("Noted.");
}

function computerScript(): DemoStep {
  return say("Built dashboard.html: October invoices by vendor, $3,410 total, one overdue (INV-88). It's in my files.");
}
