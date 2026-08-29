import { createServer } from "node:http";
import type { IGloveRunnable } from "glove-core";
import type { AgentHandlerContext } from "glove-foundry";
import { RealtimeAgent } from "glove-voice-s2s";
import { WebSocketServer, type WebSocket } from "ws";
import { SAMPLE_RATE, type CallClientMessage, type CallServerMessage } from "../../lib/call-protocol.js";
import { briefingInputSchema } from "./briefing-input.js";

function resample(pcm: Int16Array, from: number, to: number): Int16Array {
  if (from === to) return pcm;
  const output = new Int16Array(Math.floor((pcm.length * to) / from));
  const ratio = from / to;
  for (let index = 0; index < output.length; index++) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(left + 1, pcm.length - 1);
    const fraction = position - left;
    output[index] = (pcm[left]! * (1 - fraction) + pcm[right]! * fraction) | 0;
  }
  return output;
}

export async function runBriefingRoom(
  agent: IGloveRunnable,
  context: AgentHandlerContext,
): Promise<{ readonly stormId: string; readonly endedBecause: string; readonly durationMs: number }> {
  const input = briefingInputSchema.parse(context.request.payload);
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required for Mara's live briefing line.");

  const startedAt = Date.now();
  const caller: { socket: WebSocket | null } = { socket: null };
  const emit = (message: CallServerMessage): void => {
    if (caller.socket?.readyState === 1) caller.socket.send(JSON.stringify(message));
  };
  const emitAudio = (pcm: Int16Array): void => {
    const socket = caller.socket;
    if (!socket || socket.readyState !== 1) return;
    socket.send(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer, { binary: true });
  };

  const realtime = new RealtimeAgent({
    agent,
    onToolCall(name, phase) {
      emit({ t: "tool", name, phase });
      context.emit({ type: `braind.call.tool.${phase}`, data: { name, stormId: input.stormId } });
    },
  });
  let turnId = 0;
  let turnOpen = false;
  const persistTranscript = (sender: "user" | "agent", text: string): void => {
    void agent.store.appendMessages([{ sender, text }]).catch((error: unknown) => {
      context.emit({ type: "braind.call.transcript.persistence.error", data: { message: error instanceof Error ? error.message : String(error) } });
    });
  };
  realtime.on("user_said", (text) => {
    persistTranscript("user", text);
    emit({ t: "utterance", text });
  });
  realtime.on("agent_delta", (text) => {
    if (!turnOpen) { turnOpen = true; turnId++; }
    emit({ t: "speech", turnId, text });
  });
  realtime.on("agent_said", (text) => {
    persistTranscript("agent", text);
    if (!turnOpen) return;
    turnOpen = false;
    emit({ t: "speech_end", turnId });
  });
  realtime.on("error", (error) => emit({ t: "error", message: error.message }));
  realtime.adapter.on("audio", (pcm, format) => emitAudio(resample(pcm, format.sampleRate, SAMPLE_RATE)));
  realtime.adapter.on("interrupted", () => { turnOpen = false; emit({ t: "clear" }); });
  realtime.adapter.on("user_speech_stopped", () => emit({ t: "state", state: "thinking" }));
  realtime.adapter.on("agent_speech_started", () => emit({ t: "state", state: "speaking" }));
  realtime.adapter.on("agent_speech_stopped", () => emit({ t: "state", state: "listening" }));

  const server = createServer((request, response) => {
    if (new URL(request.url ?? "/", "http://localhost").pathname !== "/health") {
      response.writeHead(404).end("not found");
      return;
    }
    response.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" });
    response.end(JSON.stringify({ ok: true, stormId: input.stormId, connected: Boolean(caller.socket) }));
  });
  const sockets = new WebSocketServer({ server, path: "/call" });
  let lastDetachedAt = Date.now();
  let greeted = false;

  sockets.on("connection", (socket, request) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.searchParams.get("token") !== input.token) {
      socket.close(4403, "invalid room token");
      return;
    }
    caller.socket?.close(4400, "replaced by another caller");
    caller.socket = socket;
    context.emit({ type: "braind.call.caller.connected", data: { stormId: input.stormId, port: input.port } });
    emit({
      t: "ready",
      sessionId: context.runId,
      agent: "Mara Vale",
      model: process.env.S2S_MODEL ?? "models/gemini-3.1-flash-live-preview",
      tools: realtime.exposedTools.map((tool) => tool.name),
    });
    emit({ t: "state", state: "listening" });
    if (!greeted) {
      greeted = true;
      realtime.inject("The caller has just joined the briefing line. Greet them in one short sentence and ask whether they want the latest briefing or want to leave direction for the team.", { respond: true });
    }

    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        const bytes = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
        const pcm = new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        realtime.sendAudio(resample(pcm, SAMPLE_RATE, realtime.adapter.inputFormat.sampleRate));
        return;
      }
      let message: CallClientMessage;
      try { message = JSON.parse(data.toString()) as CallClientMessage; }
      catch { emit({ t: "error", message: "Ignored an invalid client message." }); return; }
      if (message.t === "say" && message.text.trim()) {
        const text = message.text.trim();
        persistTranscript("user", text);
        emit({ t: "utterance", text });
        realtime.inject(text, { respond: true });
      } else if (message.t === "barge_in") {
        realtime.adapter.interrupt();
      }
    });

    const detach = (): void => {
      if (caller.socket !== socket) return;
      caller.socket = null;
      lastDetachedAt = Date.now();
      context.emit({ type: "braind.call.caller.disconnected", data: { stormId: input.stormId } });
    };
    socket.on("close", detach);
    socket.on("error", detach);
  });

  let realtimeStarted = false;
  try {
    await realtime.start();
    realtimeStarted = true;
    // The adapter's connect resolves at WebSocket open; Gemini's setupComplete
    // frame follows shortly after. Do not expose a room that can race its first turn.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(input.port, "127.0.0.1", resolve);
    });
    context.emit({ type: "braind.call.room.ready", data: { stormId: input.stormId, port: input.port, tools: realtime.exposedTools.map((tool) => tool.name) } });
    const endedBecause = await new Promise<string>((resolve) => {
      let settled = false;
      const finish = (reason: string): void => {
        if (settled) return;
        settled = true;
        clearInterval(idleTimer);
        context.signal.removeEventListener("abort", abort);
        resolve(reason);
      };
      const abort = (): void => finish("cancelled");
      const idleTimer = setInterval(() => {
        if (!caller.socket && Date.now() - lastDetachedAt >= input.idleMs) finish("idle");
      }, 1_000);
      context.signal.addEventListener("abort", abort, { once: true });
      if (context.signal.aborted) abort();
    });
    return { stormId: input.stormId, endedBecause, durationMs: Date.now() - startedAt };
  } finally {
    caller.socket?.close(1001, "room closing");
    sockets.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (realtimeStarted) await realtime.stop().catch(() => undefined);
  }
}
