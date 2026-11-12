import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import type { AgentAssemblyContext } from "glove-foundry";
import { createFoundryClient } from "glove-foundry/client";
import { baristaTools } from "../agents/barista/tools.js";
import { sameBag, totals, visitKey, type Bag, type Visit } from "../lib/bag.js";
import { PRODUCTS } from "../lib/catalog.js";
import { SHOP, type TurnPayload } from "../lib/shop.js";

// One visit to the shop, end to end, over the same HTTP API the web app
// uses. The scripted barista answers, so this needs no keys and no network:
//   browse → two people order by voice (labelled lines, a name) → the barista
//   is told who is speaking → checkout waits for approval → the order is placed.
// Then the same shop through the voice pipeline (GloveVoice and the bridge
// the web app gives it), with scripted speech in place of a microphone.

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = await mkdtemp(join(tmpdir(), "foundry-coffee-"));

const port = await new Promise<number>((done, fail) => {
  const probe = createServer();
  probe.once("error", fail);
  probe.listen(0, "127.0.0.1", () => {
    const { port: free } = probe.address() as { port: number };
    probe.close(() => done(free));
  });
});

const server = spawn("pnpm", ["exec", "glove", "foundry", "start", "--port", String(port)], {
  cwd: rootDir,
  env: { ...process.env, COFFEE_DATA_DIR: dataDir, COFFEE_DEMO: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
server.stdout.on("data", (chunk) => (log += chunk));
server.stderr.on("data", (chunk) => (log += chunk));

const foundry = createFoundryClient({ baseUrl: `http://127.0.0.1:${port}` });

async function until<T>(read: () => Promise<T | undefined>, what: string, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read().catch(() => undefined);
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.\n${log}`);
    await new Promise((wait) => setTimeout(wait, 100));
  }
}

/** What the shop holds for a conversation: its bag and its orders, in one workspace entry. */
async function visitOf(conversationId: string): Promise<Visit> {
  const entries = await foundry.workspaceEntries(SHOP.workspaceId);
  return (entries.find((item) => item.key === visitKey(conversationId))?.value as Visit | undefined) ?? { bag: { lines: [] }, orders: [] };
}

/**
 * The same shop through the voice pipeline: the real GloveVoice and the
 * bridge the web app gives it (app/lib/foundry-runnable.ts), with a scripted
 * speech-to-text adapter in place of Scribe and a text-to-speech adapter that
 * records what it is asked to say. Two people speak; Scribe's part (labels
 * for who said what) is supplied by hand.
 */
// Glove runs a tool again when it throws. A checkout whose write was stored
// and then failed must come back as the order it placed, not as an empty bag.
async function checkoutAfterFailedWrite(): Promise<void> {
  const entries = new Map<string, unknown>();
  let failures = 1;
  const data = {
    getWorkspaceEntry: (_workspace: string, key: string) =>
      Effect.sync(() => (entries.has(key) ? { value: entries.get(key) } : undefined)),
    putWorkspaceEntry: (entry: { key: string; value: unknown }) =>
      Effect.promise(async () => {
        const before = (entries.get(entry.key) as Visit | undefined)?.orders.length ?? 0;
        entries.set(entry.key, entry.value);
        // Fails the write that stores an order, after storing it.
        if ((entry.value as Visit).orders.length > before && failures-- > 0) throw new Error("stored, then failed");
      }),
  };
  const tools = baristaTools({
    data,
    workspaceId: SHOP.workspaceId,
    conversationId: "retry",
    request: {},
    controls: { emit() {} },
  } as unknown as AgentAssemblyContext);
  const tool = (name: string) => tools.find((t) => t.name === name)!.do as (input: unknown) => Promise<{ status: string; data: unknown }>;
  const orders = () => (entries.get(visitKey("retry")) as Visit).orders;

  await tool("add_to_cart")({ product_id: "kenyan-aa", quantity: 1 });
  await assert.rejects(tool("checkout")({ grind: "Whole Bean" }), /stored, then failed/);
  const retried = await tool("checkout")({ grind: "Whole Bean" });
  assert.equal(retried.status, "success", "the retry reports the order that was placed");
  assert.match(String(retried.data), /Order placed/);
  assert.equal(orders().length, 1, "and places no second one");

  const again = await tool("checkout")({ grind: "Whole Bean" });
  assert.equal(again.status, "error", "a later checkout of the empty bag is still refused");
  assert.equal(orders().length, 1);

  // The same failure with no retry after it, then more coffee: the next
  // checkout is a new order, not the earlier one reported again.
  failures = 1;
  await tool("add_to_cart")({ product_id: "kenyan-aa", quantity: 1 });
  await assert.rejects(tool("checkout")({ grind: "Whole Bean" }), /stored, then failed/);
  await tool("add_to_cart")({ product_id: "colombian-huila", quantity: 2 });
  const next = await tool("checkout")({ grind: "Whole Bean" });
  assert.equal(next.status, "success");
  assert.match(String(next.data), /Huila/);
  assert.equal(orders().length, 3);

  // No more than the shelf holds, counting what is already in the bag.
  const bag = () => (entries.get(visitKey("retry")) as Visit).bag;
  const stock = PRODUCTS.find((p) => p.id === "kenyan-aa")!.stock;
  assert.equal((await tool("add_to_cart")({ product_id: "kenyan-aa", quantity: stock + 1 })).status, "error");
  assert.equal((await tool("add_to_cart")({ product_id: "kenyan-aa", quantity: stock, for: "Maya" })).status, "success");
  const over = await tool("add_to_cart")({ product_id: "kenyan-aa", quantity: 1, for: "Speaker B" });
  assert.equal(over.status, "error", "another person's line counts against the same stock");
  assert.equal(totals(bag()).count, stock);
}

async function spokenVisit(): Promise<void> {
  process.env.FOUNDRY_URL = `http://127.0.0.1:${port}`;
  console.debug = () => {}; // GloveVoice narrates every step at debug level
  const { GloveVoice } = await import("glove-voice");
  const { FoundryRunnable } = await import("../app/lib/foundry-runnable.js");
  const { followRun } = await import("../app/lib/server/run-events.js");
  const { ScriptedSTT, RecordingTTS, silentAudio } = await import("./voice-fakes.js");

  const visit = await foundry.createConversation(SHOP.agentId, { title: "verify (spoken)" });
  const sent: Array<{ text: string; payload: TurnPayload }> = [];
  let turnDone: () => void = () => {};
  let voice: InstanceType<typeof GloveVoice>;

  // What app/api/turn/route.ts and app/lib/use-shop.ts do between them.
  const runnable = new FoundryRunnable(async (text, options) => {
    const speakers = voice.speakers.map((s) => ({ label: s.label, ...(s.name ? { name: s.name } : {}) }));
    const payload: TurnPayload = { voice: { context: options.voice?.context ?? [], speakers } };
    sent.push({ text, payload });
    const handle = await foundry.send(SHOP.agentId, visit.id, text, { payload });
    try {
      for await (const event of followRun(handle.id, options.signal)) {
        if (event.type === "speaker_named") voice.nameSpeaker(event.speaker, event.name);
        await options.onEvent?.(event);
        if (event.type === "end" && event.status === "failed") throw new Error(event.error);
      }
    } finally {
      turnDone();
    }
  });

  const stt = new ScriptedSTT();
  const spoken: string[] = [];
  voice = new GloveVoice(runnable.asGlove(), {
    stt,
    createTTS: () => new RecordingTTS(spoken),
    turnMode: "manual",
    startMuted: false,
    audio: silentAudio(),
  });
  await voice.start();

  const say = async (text: string, turns: Array<[speaker: string, text: string]>) => {
    const done = new Promise<void>((resolveTurn) => (turnDone = resolveTurn));
    spoken.length = 0;
    stt.say(text, turns);
    // If the pipeline never reaches the agent, say which turn and move on to cleanup.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, fail) => {
      timer = setTimeout(() => fail(new Error(`The spoken turn "${text}" never reached the barista.`)), 60_000);
    });
    try {
      await Promise.race([done, timedOut]);
    } finally {
      clearTimeout(timer);
    }
    await new Promise((settle) => setTimeout(settle, 50));
    const last = sent.at(-1)!;
    console.log(`> (spoken) ${last.text.replaceAll("\n", " / ")}\n  barista says: ${spoken.join("")}`);
    return last;
  };

  try {
    // One voice: the barista gets plain text and no note.
    const alone = await say("Show me all your beans", [["speaker_0", "Show me all your beans"]]);
    assert.equal(alone.text, "Show me all your beans");
    assert.deepEqual(alone.payload.voice?.context, []);
    assert.ok(spoken.join("").includes("Here is what I would pour"), "the reply was sent to text-to-speech");

    // A second voice joins: lines are labelled, and the note says who is here.
    const both = await say("I'll take the Huila Reserve, my name is Maya and two Lake Kivu for me", [
      ["speaker_0", "I'll take the Huila Reserve, my name is Maya"],
      ["speaker_1", "and two Lake Kivu for me"],
    ]);
    assert.equal(both.text, "[Speaker A] I'll take the Huila Reserve, my name is Maya\n[Speaker B] and two Lake Kivu for me");
    assert.match(both.payload.voice?.context?.[0] ?? "", /<voice-speakers>[\s\S]*Speaker A[\s\S]*Speaker B/);
    assert.deepEqual((await visitOf(visit.id)).bag.lines, [
      { productId: "colombian-huila", qty: 1, for: "Maya" },
      { productId: "rwanda-kivu", qty: 2, for: "Speaker B" },
    ]);
    // The barista's name_speaker call came back and renamed the speaker here.
    assert.deepEqual(voice.speakers.map((s) => s.label), ["Maya", "Speaker B"]);

    // From then on her lines carry her name.
    const asked = await say("who is here?", [["speaker_0", "who is here?"]]);
    assert.equal(asked.text, "[Maya] who is here?");
    assert.ok(spoken.join("").includes("2 of you: Maya and Speaker B"), spoken.join(""));
  } finally {
    await voice.stop();
  }
}

try {
  // What a checkout confirmation is compared on. Two different bags can have
  // the same count and the same total, so only the lines will do.
  const onCard: Bag = { lines: [{ productId: "colombian-huila", qty: 1 }, { productId: "kenyan-aa", qty: 1 }] };
  const inStore: Bag = { lines: [{ productId: "guatemala-antigua", qty: 1 }, { productId: "rwanda-kivu", qty: 1 }] };
  assert.deepEqual(totals(onCard), totals(inStore), "the two bags cost the same");
  assert.equal(sameBag(onCard, inStore), false);
  assert.equal(sameBag(onCard, { lines: [...onCard.lines].reverse() }), true, "order does not matter");
  assert.equal(sameBag(onCard, { lines: [{ ...onCard.lines[0]!, for: "Maya" }, onCard.lines[1]!] }), false, "who it is for does");

  await checkoutAfterFailedWrite();

  await until(async () => ((await foundry.health()).ok ? true : undefined), "Foundry to start");

  const barista = (await foundry.agentInstances("barista")).find((agent) => agent.id === SHOP.agentId);
  assert.equal(barista?.workspaceId, SHOP.workspaceId, "the seeded barista");
  const visit = await foundry.createConversation(SHOP.agentId, { title: "verify" });

  async function turn(text: string, payload?: TurnPayload) {
    const handle = await foundry.send(SHOP.agentId, visit.id, text, payload ? { payload } : {});
    const run = await handle.wait({ timeoutMs: 60_000 });
    assert.equal(run.status, "completed", run.error);
    const events = await handle.events();
    const said = events.filter((e) => e.type === "agent.text_delta").map((e) => (e.data as { text: string }).text).join("");
    console.log(`> ${text.replaceAll("\n", " / ")}\n  barista: ${said}`);
    return { run, events, said };
  }

  // Typed: browse the catalogue.
  const browse = await turn("Show me all your beans");
  const shown = browse.events.find((e) => e.type === "agent.tool_use" && (e.data as { name: string }).name === "show_products");
  assert.ok(shown, "show_products was called");
  assert.ok(browse.said.length > 0, "the reply streamed as text deltas");
  assert.ok(browse.events.some((e) => e.type === "agent.model_response_complete"), "model_response_complete is relayed");

  // Spoken: two people at the counter. GloveVoice labels the lines and sends
  // who is here in the payload.
  const voice: TurnPayload["voice"] = {
    context: ["<voice-speakers>\nEach line starts with who said it.\nSpeakers so far: Speaker A (60% of the talking), Speaker B (40% of the talking).\n</voice-speakers>"],
    speakers: [{ label: "Speaker A" }, { label: "Speaker B" }],
  };
  const order = await turn(
    "[Speaker A] I'll take the Huila Reserve, my name is Maya\n[Speaker B] and two Lake Kivu for me",
    { voice },
  );
  const named = order.events.find((e) => e.type.endsWith("coffee.speaker_named"));
  assert.deepEqual(named?.data, { speaker: "Speaker A", name: "Maya" }, "the name reaches the web app as an event");
  console.log(`  event: ${named!.type} ${JSON.stringify(named!.data)}`);
  assert.deepEqual((await visitOf(visit.id)).bag.lines, [
    { productId: "colombian-huila", qty: 1, for: "Maya" },
    { productId: "rwanda-kivu", qty: 2, for: "Speaker B" },
  ]);

  // The note about who is speaking is read by the model with the turn...
  const who = await turn("who is here?", { voice });
  assert.match(who.said, /2 of you: Speaker A and Speaker B/);
  // ...and is not saved: a typed turn afterwards does not see it.
  const later = await turn("who is here?");
  assert.match(later.said, /only tell one voice/);

  // Checkout waits for the customer.
  const checkout = await foundry.send(SHOP.agentId, visit.id, "check out", {});
  const approval = await until(async () => (await foundry.approvals({ runId: checkout.id, status: "pending" }))[0], "the checkout approval");
  assert.equal(approval.toolName, "checkout");
  assert.equal((await visitOf(visit.id)).orders.length, 0, "nothing is ordered before the customer confirms");
  await foundry.resolveApproval(approval.id, "approve");
  const placed = await checkout.wait({ timeoutMs: 60_000 });
  assert.equal(placed.status, "completed", placed.error);

  const afterCheckout = await visitOf(visit.id);
  const orders = afterCheckout.orders;
  assert.equal(orders.length, 1);
  assert.equal(orders[0]!.total, 1800 + 2 * 2400, "over $40, so shipping is free");
  assert.deepEqual(afterCheckout.bag.lines, [], "the bag is emptied");
  console.log(`> check out (approved)\n  order: ${orders[0]!.lines.length} lines, total ${orders[0]!.total}`);

  // Two checkouts in one run are two orders: check out, add a coffee, check
  // out again, all from one message. Each checkout waits for its own approval.
  await turn("add the Nyeri AA");
  const twice = await foundry.send(SHOP.agentId, visit.id, "check out\nadd the Antigua\ncheck out", {});
  const answered = new Set<string>();
  for (const which of ["first", "second"]) {
    const approval = await until(
      async () => (await foundry.approvals({ runId: twice.id, status: "pending" })).find((a) => !answered.has(a.id)),
      `the ${which} checkout of the run`,
    );
    answered.add(approval.id);
    await foundry.resolveApproval(approval.id, "approve");
  }
  assert.equal((await twice.wait({ timeoutMs: 60_000 })).status, "completed");
  const afterTwice = await visitOf(visit.id);
  assert.equal(afterTwice.orders.length, 3, "both checkouts of the run placed an order");
  assert.deepEqual(afterTwice.orders[1]!.lines, [{ productId: "kenyan-aa", qty: 1 }]);
  assert.deepEqual(afterTwice.orders[2]!.lines, [{ productId: "guatemala-antigua", qty: 1 }]);
  assert.equal(new Set(afterTwice.orders.map((order) => order.id)).size, 3, "every order has its own id");
  assert.deepEqual(afterTwice.bag.lines, []);
  console.log("> check out / add the Antigua / check out (one run, both approved)\n  orders: 3");

  // A checkout that runs again after it succeeded finds an empty bag and
  // orders nothing: the bag, emptied in the same write as the order, is what
  // makes a repeat harmless.
  const replay = await foundry.send(SHOP.agentId, visit.id, "check out", {});
  const replayApproval = await until(async () => (await foundry.approvals({ runId: replay.id, status: "pending" }))[0], "the repeated checkout");
  await foundry.resolveApproval(replayApproval.id, "approve");
  assert.equal((await replay.wait({ timeoutMs: 60_000 })).status, "completed");
  assert.equal((await visitOf(visit.id)).orders.length, 3, "a repeated checkout places no second order");

  // Declining leaves the bag alone.
  await turn("add the Antigua");
  const second = await foundry.send(SHOP.agentId, visit.id, "check out", {});
  const declined = await until(async () => (await foundry.approvals({ runId: second.id, status: "pending" }))[0], "the second approval");
  await foundry.resolveApproval(declined.id, "deny");
  assert.equal((await second.wait({ timeoutMs: 60_000 })).status, "completed");
  const afterDecline = await visitOf(visit.id);
  assert.equal(afterDecline.orders.length, 3, "a declined checkout orders nothing");
  assert.equal(afterDecline.bag.lines.length, 1, "and keeps the bag");

  await spokenVisit();

  console.log("\nfoundry-coffee: ok");
} finally {
  server.kill("SIGTERM");
  await new Promise((wait) => setTimeout(wait, 300));
  await rm(dataDir, { recursive: true, force: true });
}
