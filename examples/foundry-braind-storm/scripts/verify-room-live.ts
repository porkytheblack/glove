import assert from "node:assert/strict";
import WebSocket from "ws";
import { readBriefingSnapshot } from "../agents/briefing-line/briefing-workspace.js";

const baseUrl = process.env.BRAIND_WEB_URL ?? "http://127.0.0.1:3003";
const stormId = `room-check-${Date.now()}`;
const start = await fetch(`${baseUrl}/api/calls`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ stormId }),
});
const room = await start.json() as { runId?: string; port?: number; wsUrl?: string; error?: string };
assert.equal(start.ok, true, room.error);
assert.ok(room.runId && room.port && room.wsUrl, "The call route did not return a complete room allocation.");

try {
  const deadline = Date.now() + 45_000;
  for (;;) {
    assert.ok(Date.now() < deadline, "The Foundry briefing room did not become ready.");
    const health = await fetch(`${baseUrl}/api/calls?runId=${encodeURIComponent(room.runId)}&port=${room.port}`).then((response) => response.json()) as { ready?: boolean; dead?: boolean; error?: string };
    assert.equal(health.dead, false, health.error);
    if (health.ready) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  const tools = new Set<string>();
  const exposedTools = new Set<string>();
  const speech: string[] = [];
  const errors: string[] = [];
  const socket = new WebSocket(room.wsUrl);
  let sent = false;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("The live Foundry room did not complete its typed verification turn.")), 55_000);
    const sendInstruction = (): void => {
      if (sent) return;
      sent = true;
      socket.send(JSON.stringify({
        t: "say",
        text: "Use get_storm_briefing, then use record_direction to record: Make every launch example concrete and based on real work; priority important; applies to launch examples. Confirm when done.",
      }));
    };
    socket.on("open", () => setTimeout(sendInstruction, 1_500));
    socket.on("message", (data, isBinary) => {
      if (isBinary) return;
      const message = JSON.parse(data.toString()) as Record<string, unknown>;
      if (message.t === "ready" && Array.isArray(message.tools)) for (const name of message.tools) exposedTools.add(String(name));
      if (message.t === "tool" && message.phase === "done") tools.add(String(message.name));
      if (message.t === "speech") speech.push(String(message.text));
      if (message.t === "error") errors.push(String(message.message));
      if (sent && message.t === "speech_end" && tools.size >= 2) {
        clearTimeout(timeout);
        resolve();
      }
    });
    socket.on("error", reject);
  });
  socket.close();

  assert.deepEqual([...exposedTools].sort(), ["get_storm_briefing", "launch_campaign_workforce", "record_direction"]);
  assert.deepEqual([...tools].sort(), ["get_storm_briefing", "record_direction"]);
  assert.ok(speech.join("").trim(), "The room returned no speech transcript.");
  assert.deepEqual(errors, []);
  const snapshot = await readBriefingSnapshot(stormId, "headline");
  assert.equal(snapshot.recordedDirections.some((item) => item.includes("real work")), true);
  process.stdout.write(`Braind Storm Foundry room verification passed (${stormId}).\n`);
  process.stdout.write("Verified Next route allocation, Foundry run startup, WebSocket protocol, all three exposed tools, transcript streaming, and durable direction.\n");
} finally {
  if (room.runId) await fetch(`${baseUrl}/api/calls?runId=${encodeURIComponent(room.runId)}`, { method: "DELETE" }).catch(() => undefined);
}
