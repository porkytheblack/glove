import type {
  Message,
  ModelAdapter,
  ModelPromptResult,
  NotifySubscribersFunction,
  PromptRequest,
  ToolCall,
} from "glove-core";
import { PRODUCTS } from "./catalog.js";

/**
 * A scripted barista, used when no model key is set (or COFFEE_DEMO=1). It
 * reads the customer's last message with a few patterns and calls the real
 * tools, so the whole path (Foundry run, tools, bag, checkout approval, the
 * web app, the voice pipeline) works with no model provider. It is not smart:
 * a real model replaces it as soon as a key is set.
 */
export class DemoBarista implements ModelAdapter {
  readonly name = "demo-barista";
  setSystemPrompt(): void {}

  async prompt(request: PromptRequest, notify: NotifySubscribersFunction): Promise<ModelPromptResult> {
    // Runtime context rides at the tail of the messages; the turn is the last
    // message that is not context.
    const turn = [...request.messages].reverse().find((m) => !m.framework_context)!;
    const speakersNote = request.messages.find((m) => m.text?.includes("<voice-speakers>"))?.text;

    if (turn.tool_results?.length) {
      return say(notify, afterTools(turn.tool_results.map((r) => ({ name: r.tool_name, result: r.result }))));
    }

    const calls = turn.sender === "user" ? plan(turn.text ?? "", request) : [];
    if (calls.length > 0) return call(notify, calls);
    if (/who (is|are) (here|speaking|talking)|how many of (us|you)/i.test(turn.text ?? "")) {
      // GloveVoice's note reads "Speakers so far: Maya (60% of the talking), Speaker B (40% ...)."
      const listed = /Speakers so far: (.+)\./.exec(speakersNote ?? "")?.[1] ?? "";
      const labels = listed.split(", ").map((part) => part.replace(/ \(.*\)$/, "").trim()).filter(Boolean);
      return say(notify, labels.length > 0 ? `I can hear ${labels.length} of you: ${labels.join(" and ")}.` : "I can only tell one voice so far.");
    }
    return say(
      notify,
      "Welcome to Glove Coffee. This is the scripted demo barista: try \"show me all your beans\", \"add the Huila Reserve\", \"what is in my bag\" or \"check out\".",
    );
  }
}

interface Planned {
  readonly tool: string;
  readonly input: Record<string, unknown>;
}

const NUMBERS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5 };

function productIn(text: string): string | undefined {
  const lower = text.toLowerCase();
  return PRODUCTS.find((p) => lower.includes(p.name.toLowerCase()) || lower.includes(p.origin.toLowerCase()))?.id;
}

/** What the scripted barista does with one message. A spoken message can hold a line per speaker. */
function plan(text: string, request: PromptRequest): Planned[] {
  const canName = request.tools?.some((tool) => tool.name === "name_speaker") ?? false;
  const planned: Planned[] = [];
  for (const raw of text.split("\n")) {
    const labelled = /^\[([^\]]+)\]\s*(.*)$/.exec(raw.trim());
    const who = labelled?.[1];
    const line = (labelled?.[2] ?? raw).trim();
    if (!line) continue;

    const named = /\b(?:[Mm]y name is|I am|I'm|[Cc]all me|[Tt]his is)\s+([A-Z][a-z]+)/.exec(line)?.[1];
    if (named && who && canName) planned.push({ tool: "name_speaker", input: { speaker: who, name: named } });

    const product = productIn(line);
    const quantity = Number(/\b(\d+)\b/.exec(line)?.[1]) || NUMBERS[/\b(an?|one|two|three|four|five)\b/i.exec(line)?.[1]?.toLowerCase() ?? ""] || 1;
    if (/\b(check ?out|place (the|my|our) order|pay|that's all|that is all)\b/i.test(line)) {
      planned.push({ tool: "checkout", input: { grind: "Whole Bean" } });
    } else if (product && /\b(remove|take out|drop|without)\b/i.test(line)) {
      planned.push({ tool: "remove_from_cart", input: { product_id: product, ...(who ? { for: named ?? who } : {}) } });
    } else if (product && /\b(add|take|want|get|have|order|buy|for me)\b/i.test(line)) {
      planned.push({ tool: "add_to_cart", input: { product_id: product, quantity, ...(who ? { for: named ?? who } : {}) } });
    } else if (product) {
      planned.push({ tool: "show_product_detail", input: { product_id: product } });
    } else if (/\b(bag|cart|basket)\b/i.test(line)) {
      planned.push({ tool: "get_cart", input: {} });
    } else if (/\b(light|fruity|floral|bright)\b/i.test(line)) {
      planned.push({ tool: "show_products", input: { product_ids: ["rwanda-kivu", "kenyan-aa"], note: "Light and fruit-forward" } });
    } else if (/\b(bold|rich|dark|strong|chocolat)/i.test(line)) {
      planned.push({ tool: "show_products", input: { product_ids: ["guatemala-antigua", "colombian-huila"], note: "Fuller and richer" } });
    } else if (/\b(show|browse|beans|menu|coffees?|recommend|choose|everything|all)\b/i.test(line)) {
      planned.push({ tool: "show_products", input: { product_ids: ["all"] } });
    }
  }
  return planned;
}

function afterTools(results: Array<{ name: string; result: { status: string; data?: unknown; message?: string } }>): string {
  const said: string[] = [];
  for (const { name, result } of results) {
    const text = typeof result.data === "string" ? result.data : "";
    if (result.status !== "success") {
      said.push(name === "checkout" ? "No problem, I have left your bag as it is." : `Sorry: ${result.message ?? "that did not work"}`);
    } else if (name === "show_products") {
      said.push("Here is what I would pour for you. Tap one, or tell me which sounds good.");
    } else if (name === "show_product_detail") {
      said.push(`${text.split(". ")[0]}. Shall I add it to your bag?`);
    } else if (name === "add_to_cart") {
      said.push(`${text.split("\n")[0]} ${text.split("\n").at(-1) ?? ""}`.trim());
    } else if (name === "remove_from_cart" || name === "get_cart") {
      said.push(text.split("\n").join(" "));
    } else if (name === "checkout") {
      said.push("Your order is placed. Thank you!");
    } else if (name === "name_speaker") {
      said.push(`Nice to meet you, ${(result.data as { name?: string } | undefined)?.name ?? "there"}.`);
    }
  }
  return said.join(" ") || "Done.";
}

async function say(notify: NotifySubscribersFunction, text: string): Promise<ModelPromptResult> {
  // Stream it a few words at a time, as a real model would.
  const words = text.split(/(?<=\s)/);
  for (let i = 0; i < words.length; i += 3) {
    await notify("text_delta", { text: words.slice(i, i + 3).join("") });
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  await notify("model_response_complete", { text, stop_reason: "end_turn", tokens_in: 1, tokens_out: 1 });
  return { messages: [{ sender: "agent", text }], tokens_in: 1, tokens_out: 1 };
}

async function call(notify: NotifySubscribersFunction, planned: Planned[]): Promise<ModelPromptResult> {
  const stamp = Date.now();
  const calls: ToolCall[] = planned.map((p, i) => ({ id: `demo_${stamp}_${i}`, tool_name: p.tool, input_args: p.input }));
  for (const c of calls) await notify("tool_use", { id: c.id!, name: c.tool_name, input: c.input_args });
  await notify("model_response_complete", { text: "", tool_calls: calls, stop_reason: "tool_use", tokens_in: 1, tokens_out: 1 });
  const message: Message = { sender: "agent", text: "", tool_calls: calls };
  return { messages: [message], tokens_in: 1, tokens_out: 1 };
}
