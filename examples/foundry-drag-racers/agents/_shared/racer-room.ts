import { createServer } from "node:http";
import type { IGloveRunnable } from "glove-core";
import type { AgentHandlerContext } from "glove-foundry";
import { RealtimeAgent } from "glove-voice-s2s";
import { WebSocketServer, type WebSocket } from "ws";
import { SAMPLE_RATE, type ClientMessage, type ServerMessage } from "../../lib/protocol.js";
import { roomInputSchema } from "../../lib/room-input.js";
import type { RacerProfile } from "../../lib/racers.js";

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

export async function runRacerRoom(
  agent: IGloveRunnable,
  context: AgentHandlerContext,
  profile: RacerProfile,
): Promise<{ readonly racer: string; readonly endedBecause: string; readonly durationMs: number }> {
  const input = roomInputSchema.parse(context.request.payload);
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.");
  }

  const startedAt = Date.now();
  const caller: { socket: WebSocket | null } = { socket: null };
  const emit = (message: ServerMessage): void => {
    const socket = caller.socket;
    if (socket && socket.readyState === 1) {
      socket.send(JSON.stringify(message));
    }
  };
  const emitAudio = (pcm: Int16Array): void => {
    const socket = caller.socket;
    if (!socket || socket.readyState !== 1) return;
    socket.send(
      pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer,
      { binary: true },
    );
  };

  const realtime = new RealtimeAgent({
    agent,
    onToolCall(name, phase) {
      emit({ t: "tool", name, phase });
      context.emit({ type: `racer.tool.${phase}`, data: { name, racer: profile.id } });
    },
  });

  let turnId = 0;
  let turnOpen = false;
  const persistTranscript = (sender: "user" | "agent", text: string): void => {
    void agent.store.appendMessages([{ sender, text }]).catch((error: unknown) => {
      context.emit({
        type: "racer.transcript.persistence.error",
        data: { message: error instanceof Error ? error.message : String(error) },
      });
    });
  };
  realtime.on("user_said", (text) => {
    persistTranscript("user", text);
    emit({ t: "utterance", text });
  });
  realtime.on("agent_delta", (text) => {
    if (!turnOpen) {
      turnOpen = true;
      turnId++;
    }
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
  realtime.adapter.on("interrupted", () => {
    turnOpen = false;
    emit({ t: "clear" });
  });
  realtime.adapter.on("user_speech_stopped", () => emit({ t: "state", state: "thinking" }));
  realtime.adapter.on("agent_speech_started", () => emit({ t: "state", state: "speaking" }));
  realtime.adapter.on("agent_speech_stopped", () => emit({ t: "state", state: "listening" }));

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/health") {
      response.writeHead(404).end("not found");
      return;
    }
    response.writeHead(200, {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    });
    response.end(JSON.stringify({ ok: true, racer: profile.id, connected: Boolean(caller.socket) }));
  });
  const sockets = new WebSocketServer({ server, path: "/call" });

  let lastDetachedAt = Date.now();
  sockets.on("connection", (socket, request) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.searchParams.get("token") !== input.token) {
      socket.close(4403, "invalid room token");
      return;
    }
    caller.socket?.close(4400, "replaced by another caller");
    caller.socket = socket;
    context.emit({ type: "racer.caller.connected", data: { racer: profile.id, port: input.port } });
    emit({
      t: "ready",
      sessionId: context.runId,
      racer: profile.name,
      model: process.env.S2S_MODEL ?? "models/gemini-3.1-flash-live-preview",
      tools: realtime.exposedTools.map((tool) => tool.name),
    });
    emit({ t: "state", state: "listening" });

    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        const bytes = Buffer.isBuffer(data)
          ? data
          : Array.isArray(data)
            ? Buffer.concat(data)
            : Buffer.from(data);
        const pcm = new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        realtime.sendAudio(resample(pcm, SAMPLE_RATE, realtime.adapter.inputFormat.sampleRate));
        return;
      }
      let message: ClientMessage;
      try {
        message = JSON.parse(data.toString()) as ClientMessage;
      } catch {
        emit({ t: "error", message: "Ignored an invalid client message." });
        return;
      }
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
      context.emit({ type: "racer.caller.disconnected", data: { racer: profile.id } });
    };
    socket.on("close", detach);
    socket.on("error", detach);
  });

  let realtimeStarted = false;
  try {
    await realtime.start();
    realtimeStarted = true;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(input.port, "127.0.0.1", resolve);
    });
    context.emit({
      type: "racer.room.ready",
      data: { racer: profile.id, port: input.port, tools: realtime.exposedTools.map((tool) => tool.name) },
    });

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
    return { racer: profile.id, endedBecause, durationMs: Date.now() - startedAt };
  } finally {
    caller.socket?.close(1001, "room closing");
    sockets.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (realtimeStarted) await realtime.stop().catch(() => undefined);
  }
}
