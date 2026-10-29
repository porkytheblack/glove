import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { createSalesDemo } from "./agent";

// Real GPT-Live: paced silence + typed prospect replies, actual backend tool
// calls, voice transcripts/audio, goal persistence, and a mid-call event.
const demo = await createSalesDemo();
const session = demo.createSession();
const evidence = {
  provider: "openai-live", model: "gpt-live-1", input: "typed prospect replies plus continuous PCM silence", passed: false,
  tools: [] as Array<{ name: string; status: string }>, transcript: "", audioSamples: 0,
  checks: {} as Record<string, boolean>, usage: [] as Array<{ seconds?: number; final?: boolean }>, errors: [] as string[],
};
let lastVoicedAt = 0;
const audio: Buffer[] = [];
session.on("tool_finished", (call, result) => {
  evidence.tools.push({ name: call.name, status: result.status });
  console.log(`Tool: ${call.name} (${result.status})`);
});
session.on("transcript", f => {
  if (f.role === "assistant") { evidence.transcript += f.text; process.stdout.write(f.text); }
});
session.on("audio", pcm => {
  evidence.audioSamples += pcm.length;
  audio.push(Buffer.from(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength)));
  let energy = 0; for (const sample of pcm) energy += (sample / 32768) ** 2;
  if (Math.sqrt(energy / Math.max(1, pcm.length)) > .004) lastVoicedAt = Date.now();
  session.notifyPlayback(Date.now() - lastVoicedAt < 400);
});
session.on("usage", usage => evidence.usage.push(usage));
session.on("error", error => evidence.errors.push(error.message));
async function until(label: string, check: () => boolean | Promise<boolean>, timeoutMs = 55_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (evidence.errors.length) throw new Error(evidence.errors.at(-1));
    if (await check()) { console.log(`\nPASS: ${label}`); return; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}`);
}
const quiet = () => until("assistant finished speaking", () => lastVoicedAt > 0 && Date.now() - lastVoicedAt > 1000, 25_000);
let silence: ReturnType<typeof setInterval> | undefined;
try {
  await session.start();
  evidence.checks.providerAcceptedSession = true;
  silence = setInterval(() => session.sendAudio(new Int16Array(480)), 20);
  session.respond("Open the sales discovery call now. Introduce yourself as an AI assistant and ask whether this is a good time to discuss their appointment booking needs. Ask one question, then listen.");
  await until("agent initiated the call", () => /\?/.test(evidence.transcript) && /AI|artificial intelligence/i.test(evidence.transcript));
  evidence.checks.agentInitiated = true;
  await quiet();
  await session.say("Yes, now is a good time. I run a salon. We book appointments by phone and send reminders manually. We do about 250 appointments per month. Reducing no-shows is my main priority.");
  await until("agent recorded discovery goals and consulted product facts", async () =>
    (await demo.runner.status())?.goals.find(g => g.definition.key === "discover")?.status === "completed" &&
    evidence.tools.some(t => t.name === "lookup_plans" && t.status === "success"));
  evidence.checks.discoveryRecordedByModel = true;
  await until("agent recommended a plan", () => /growth/i.test(evidence.transcript));
  await quiet();
  const beforeEvent = evidence.transcript.length;
  await demo.offer();
  await until("agent proactively relayed the new offer", () => /39|thirty[ -]?nine/i.test(evidence.transcript.slice(beforeEvent)));
  evidence.checks.spontaneousOfferSpoken = true;
  await quiet();
  await session.say("The Growth plan and that new price sound good. You have answered my questions. Yes, I would like a product demo as the next step.");
  await until("agent recorded an agreed next step and settled the goals", async () => {
    const snapshot = await demo.snapshot();
    return snapshot.decision === "demo" && snapshot.goals?.status === "completed";
  });
  evidence.checks.modelCompletedGoals = true;
  await demo.offer(); // same event ID: no duplicate history entry
  await quiet();
  await session.stop();
  const initial = await demo.snapshot();
  assert.equal(initial.history.filter(m => m.kind === "event").length, 1);
  assert.ok(initial.history.filter(m => m.kind === "glove.goals").length >= 2);
  evidence.checks.eventSavedOnce = true;
  evidence.checks.changedGoalSnapshotsSaved = true;
  const version = initial.goals!.version;
  await session.start();
  const beforeResume = evidence.transcript.length;
  await session.say("We got disconnected. Remind me what next step we agreed on.");
  await until("new provider session recalled the agreed next step", () => /demo/i.test(evidence.transcript.slice(beforeResume)));
  assert.equal((await demo.runner.status())?.version, version, "recall must not reset or rewrite goal progress");
  evidence.checks.reconnectRetainedGoals = true;
  await session.stop();
  assert.ok(evidence.usage.filter(u => u.final).length >= 2);
  evidence.checks.finalUsageConfirmed = true;
  evidence.passed = true;
} catch (error) {
  evidence.errors.push(error instanceof Error ? error.message : String(error)); process.exitCode = 1;
} finally {
  if (silence) clearInterval(silence);
  try { await session.stop(); } catch (error) { evidence.errors.push(String(error)); process.exitCode = 1; evidence.passed = false; }
  const reportPath = process.env.DEMO_REPORT ?? "/tmp/glove-live-goals-report.json";
  await writeFile(reportPath, JSON.stringify({ ...evidence, finalState: await demo.snapshot() }, null, 2));
  const pcm = Buffer.concat(audio), header = Buffer.alloc(44);
  header.write("RIFF"); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  await writeFile(reportPath.replace(/\.json$/, "") + ".wav", Buffer.concat([header, pcm]));
  console.log("\n" + JSON.stringify(evidence, null, 2));
}
