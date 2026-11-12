import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createFoundryClient } from "glove-foundry/client";
import { visitKey, type Visit } from "../lib/bag.js";
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

  // A second order in the same conversation is its own order.
  await turn("add the Nyeri AA");
  const again = await foundry.send(SHOP.agentId, visit.id, "check out", {});
  const repeat = await until(async () => (await foundry.approvals({ runId: again.id, status: "pending" }))[0], "the repeat approval");
  await foundry.resolveApproval(repeat.id, "approve");
  assert.equal((await again.wait({ timeoutMs: 60_000 })).status, "completed");
  const twoOrders = (await visitOf(visit.id)).orders;
  assert.equal(twoOrders.length, 2);
  assert.notEqual(twoOrders[0]!.id, twoOrders[1]!.id);

  // Declining leaves the bag alone.
  await turn("add the Antigua");
  const second = await foundry.send(SHOP.agentId, visit.id, "check out", {});
  const declined = await until(async () => (await foundry.approvals({ runId: second.id, status: "pending" }))[0], "the second approval");
  await foundry.resolveApproval(declined.id, "deny");
  assert.equal((await second.wait({ timeoutMs: 60_000 })).status, "completed");
  const afterDecline = await visitOf(visit.id);
  assert.equal(afterDecline.orders.length, 2, "a declined checkout orders nothing");
  assert.equal(afterDecline.bag.lines.length, 1, "and keeps the bag");

  await spokenVisit();

  console.log("\nfoundry-coffee: ok");
} finally {
  server.kill("SIGTERM");
  await new Promise((wait) => setTimeout(wait, 300));
  await rm(dataDir, { recursive: true, force: true });
}
