import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import { createSalesDemo } from "./agent";
import type { RealtimeSession } from "../../src/index";

const port = Number(process.env.PORT ?? 4317);
const origin = `http://127.0.0.1:${port}`;
const files: Record<string, [string, string]> = {
  "/": ["index.html", "text/html"],
  "/client.js": ["client.js", "text/javascript"],
  "/capture.js": ["capture.js", "text/javascript"],
};
const command = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start") }), z.object({ type: z.literal("stop") }),
  z.object({ type: z.literal("offer") }), z.object({ type: z.literal("reset") }),
  z.object({ type: z.literal("text"), text: z.string().trim().min(1).max(2000) }),
  z.object({ type: z.literal("speech"), speaking: z.boolean() }),
  z.object({ type: z.literal("playback"), speaking: z.boolean() }),
]);
let demo = await createSalesDemo();
let active: WebSocket | undefined;
let session: RealtimeSession | undefined;
const server = createServer(async (request, response) => {
  const file = files[request.url ?? ""];
  if (request.method !== "GET" || !file || request.headers.host !== `127.0.0.1:${port}`) {
    response.writeHead(404).end(); return;
  }
  try {
    response.writeHead(200, { "Content-Type": file[1], "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    response.end(await readFile(new URL(file[0], import.meta.url)));
  } catch { response.end(); }
});
const sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
server.on("upgrade", (request, socket, head) => {
  // This is a local development server, not a deployable authentication layer.
  if (request.url !== "/call" || request.headers.origin !== origin || active) {
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return;
  }
  sockets.handleUpgrade(request, socket, head, ws => sockets.emit("connection", ws));
});
sockets.on("connection", ws => {
  active = ws;
  let chain = Promise.resolve();
  const send = (type: string, data: unknown) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, data })); };
  const snapshot = async () => send("snapshot", await demo.snapshot());
  // Keep the inspector current when an idle event is saved asynchronously.
  const updates = setInterval(() => { void snapshot().catch(error => send("error", error.message)); }, 1000);
  const stop = async () => { const current = session; session = undefined; if (current) await current.stop(); };
  const start = async () => {
    await stop();
    if (ws.readyState !== WebSocket.OPEN) return;
    const current = demo.createSession();
    session = current;
    current.on("state", state => send("state", state));
    current.on("transcript", fragment => send("transcript", fragment));
    current.on("audio", pcm => {
      if (ws.readyState === WebSocket.OPEN) ws.send(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
    });
    current.on("interrupted", () => send("flush", null));
    current.on("tool_started", call => send("tool", { ...call, phase: "started" }));
    current.on("tool_finished", (call, result) => {
      send("tool", { name: call.name, phase: result.status });
      void snapshot().catch(error => send("error", error.message));
    });
    current.on("usage", usage => send("usage", usage));
    current.on("error", error => send("error", error.message));
    current.on("ended", reason => { send("ended", reason); void snapshot().catch(() => {}); });
    const returning = (await demo.store.getMessages()).some(message => message.sender === "agent" && message.text);
    await current.start();
    send("ready", current.adapter.inputFormat);
    current.respond(returning
      ? "Resume the existing conversation using saved goals and history. Briefly recap the last agreed next step or ask the next unanswered question. Do not restart discovery."
      : "Open the sales discovery call now. Introduce yourself as an AI assistant and ask whether this is a good time to discuss their appointment booking needs. Ask one question, then listen.");
    await snapshot();
  };
  ws.on("message", (raw, binary) => {
    if (binary) {
      const bytes = Buffer.from(raw as Buffer);
      if (bytes.length % 2 === 0) {
        const pcm = new Int16Array(bytes.length / 2);
        for (let i = 0; i < pcm.length; i++) pcm[i] = bytes.readInt16LE(i * 2);
        session?.sendAudio(pcm);
      }
      return;
    }
    try {
      const msg = command.parse(JSON.parse(String(raw)));
      // Playback/speech signals must not queue behind slow context/tool work.
      if (msg.type === "playback") { session?.notifyPlayback(msg.speaking); return; }
      if (msg.type === "speech") { void session?.notifyUserSpeech(msg.speaking).catch(error => send("error", error.message)); return; }
      chain = chain.then(async () => {
        if (msg.type === "start") await start();
        else if (msg.type === "stop") { await stop(); await snapshot(); }
        else if (msg.type === "reset") { await stop(); demo = await createSalesDemo(); await snapshot(); }
        else {
          if (!session || session.state !== "open") throw new Error("Start the call first.");
          if (msg.type === "text") { await session.say(msg.text); await snapshot(); }
          else if (msg.type === "offer") { send("event", await demo.offer()); await snapshot(); }
        }
      }).catch(error => send("error", error.message));
    } catch { send("error", "Invalid command."); }
  });
  ws.on("error", () => {});
  ws.on("close", () => {
    clearInterval(updates);
    // Keep the ownership lock until provider finalization finishes.
    chain = chain.then(stop).catch(error => console.error(error.message)).finally(() => { if (active === ws) active = undefined; });
  });
  void snapshot().catch(error => send("error", error.message));
});
server.listen(port, "127.0.0.1", () => console.log(`Glove Live goals demo: ${origin}`));
async function shutdown() {
  try { await session?.stop(); } catch (error) { console.error(String(error)); }
  for (const ws of sockets.clients) ws.terminate();
  sockets.close(); server.close();
}
process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });
