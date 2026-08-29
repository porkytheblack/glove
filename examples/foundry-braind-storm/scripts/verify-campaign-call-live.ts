import assert from "node:assert/strict";
import WebSocket from "ws";

const baseUrl = process.env.BRAIND_WEB_URL ?? "http://127.0.0.1:3003";
const stormId = `voice-action-${Date.now()}`;
const start = await fetch(`${baseUrl}/api/calls`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ stormId }),
});
const room = await start.json() as { runId?: string; port?: number; wsUrl?: string; error?: string };
assert.equal(start.ok, true, room.error);
assert.ok(room.runId && room.port && room.wsUrl, "The call route did not return a complete room allocation.");

try {
  const roomDeadline = Date.now() + 45_000;
  for (;;) {
    assert.ok(Date.now() < roomDeadline, "The Foundry briefing room did not become ready.");
    const health = await fetch(`${baseUrl}/api/calls?runId=${encodeURIComponent(room.runId)}&port=${room.port}`).then((response) => response.json()) as { ready?: boolean; dead?: boolean; error?: string };
    assert.equal(health.dead, false, health.error);
    if (health.ready) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  const completedTools = new Set<string>();
  const speech: string[] = [];
  const errors: string[] = [];
  const socket = new WebSocket(room.wsUrl);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Gemini Live did not launch the campaign workforce in time.")), 70_000);
    let instructed = false;
    const instruct = (): void => {
      if (instructed) return;
      instructed = true;
      socket.send(JSON.stringify({
        t: "say",
        text: "Launch the workforce now for exactly one campaign. Use id voice-launch, name Voice launch verification, no dependencies, execution sequential, marketing skills, and generateImage false. Brief: Create a concise launch campaign for a private local-first AI workspace for working architects, including positioning, go-to-market, creative direction, critique, and campaign documents. Do not merely record direction. Confirm the batch run id after the launch tool succeeds.",
      }));
    };
    socket.on("open", () => setTimeout(instruct, 1_500));
    socket.on("message", (data, isBinary) => {
      if (isBinary) return;
      const message = JSON.parse(data.toString()) as Record<string, unknown>;
      if (message.t === "tool" && message.phase === "done") completedTools.add(String(message.name));
      if (message.t === "speech") speech.push(String(message.text));
      if (message.t === "error") errors.push(String(message.message));
      if (message.t === "speech_end" && completedTools.has("launch_campaign_workforce")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    socket.on("error", reject);
  });
  socket.close();

  assert.equal(completedTools.has("launch_campaign_workforce"), true);
  assert.deepEqual(errors, []);
  assert.ok(speech.join("").trim(), "Mara did not speak after launching the batch.");

  type Batch = { runId: string; status: string; items: Array<{ status: string; runId?: string; artifactCount?: number }> };
  let batch: Batch | undefined;
  const batchDeadline = Date.now() + 7 * 60_000;
  while (Date.now() < batchDeadline) {
    const response = await fetch(`${baseUrl}/api/campaigns?parentStormId=${encodeURIComponent(stormId)}`, { cache: "no-store" });
    const body = await response.json() as { batches?: Batch[] };
    batch = body.batches?.[0];
    if (batch && ["completed", "failed", "cancelled"].includes(batch.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  assert.ok(batch, "The call tool did not create a visible campaign batch.");
  assert.equal(batch.status, "completed");
  assert.equal(batch.items.length, 1);
  assert.equal(batch.items[0]?.status, "completed");
  assert.equal(batch.items[0]?.artifactCount, 6);
  process.stdout.write(`Braind Storm call-to-workforce verification passed (${stormId}).\n`);
  process.stdout.write(`Gemini Live launched batch ${batch.runId}; its isolated five-agent campaign run completed with six artifacts.\n`);
} finally {
  if (room.runId) await fetch(`${baseUrl}/api/calls?runId=${encodeURIComponent(room.runId)}`, { method: "DELETE" }).catch(() => undefined);
}
