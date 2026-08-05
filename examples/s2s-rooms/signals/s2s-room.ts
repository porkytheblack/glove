// ─────────────────────────────────────────────────────────────────────────────
// An S2S room — the same room primitive, with the cascaded pipeline deleted.
//
// signals/room.ts runs VAD → STT → endpointing → front agent → TTS across
// ~2200 lines of session machinery (voice-session.ts + turn-engine.ts),
// because a text model cannot hear. A speech-to-speech model can, so this room
// keeps the ARCHITECTURE — a long-lived signal run owning one conversation,
// audio duct to the browser, delegation to the capable worker over the mesh —
// and replaces the entire pipeline with one RealtimeAgent on a Gemini Live
// session in transport mode. The provider now owns endpointing, barge-in and
// the voice; the room owns the layering:
//
//   browser ──16k PCM──▶ this room ──▶ GeminiLiveAdapter (transport mode)
//   browser ◀─16k PCM── resample 24k ◀─┘        │ tool_call: glove_mesh_send_message
//                                               ▼
//                                     research SIGNAL — the capable worker,
//                                     own process, 12 DB tools (unchanged)
//                                               │ threaded mesh reply
//   POST /mesh ◀────────────────────────────────┘
//     └─▶ rt.inject("<worker-result>…", { respond: true })  — spoken relay
//
// The front agent (lib/s2s-front-agent.ts) is a plain Glove: its tools —
// including the mesh send folded by mountMesh — are exposed to the realtime
// model by RealtimeAgent, and every call executes through the same Tool.run
// the text room uses. The research signal, the mesh transport, the worker,
// and the room-allocation API are all reused verbatim.
// ─────────────────────────────────────────────────────────────────────────────

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { signal, z, configure } from "station-signal";
import { SqliteAdapter } from "station-adapter-sqlite";
import { WebSocketServer, type WebSocket } from "ws";
import { MemoryStore } from "glove-core";
import { mountMesh } from "glove-mesh";
import { RealtimeAgent } from "glove-voice-s2s";
import { research } from "./research";
import { buildS2SFrontAgent } from "../lib/s2s-front-agent";
import {
  FRONT_IDENTITY,
  RoomMeshAdapter,
  type MeshEnvelope,
} from "../lib/mesh-transport";
import { SAMPLE_RATE, type ClientMessage, type ServerMessage, type SpeakerRole } from "../lib/protocol";
import { ASSISTANT_NAME, SPEAKERS, frameUtterance } from "../lib/speakers";

export const S2S_ROOM_CONCURRENCY = Number(process.env.ROOM_SLOTS ?? 4);
export const S2S_ROOM_MAX_MS = Number(process.env.ROOM_MAX_MS ?? 60 * 60_000);

/** Linear resample — Gemini speaks 24 kHz, the client duct plays 16 kHz.
 *  Keeping the client a fixed-rate duct is worth more than the last bit of
 *  fidelity here; swap for a proper polyphase filter if it ever matters. */
function resample(pcm: Int16Array, from: number, to: number): Int16Array {
  if (from === to) return pcm;
  const outLen = Math.floor((pcm.length * to) / from);
  const out = new Int16Array(outLen);
  const ratio = from / to;
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, pcm.length - 1);
    const frac = pos - i0;
    out[i] = (pcm[i0] * (1 - frac) + pcm[i1] * frac) | 0;
  }
  return out;
}

export const s2sRoom = signal("s2s-room")
  .input(
    z.object({
      roomId: z.string(),
      /** Assigned by the app, which probes for a free one. */
      port: z.number(),
      /** Proves an inbound /mesh POST belongs to a job this room dispatched. */
      meshToken: z.string(),
      dbPath: z.string().default("./station.db"),
      /** Which realtime provider drives the room. Default: S2S_PROVIDER, else
       *  whichever of OPENAI_API_KEY / GEMINI_API_KEY is set (OpenAI wins). */
      provider: z
        .enum(["openai", "gemini"])
        .default(
          (process.env.S2S_PROVIDER as "openai" | "gemini" | undefined) ??
            (process.env.OPENAI_API_KEY ? "openai" : "gemini"),
        ),
      /** Realtime model — provider-specific; empty picks the provider default
       *  ("gpt-realtime" / "models/gemini-live-2.5-flash-preview"). */
      model: z.string().default(process.env.S2S_MODEL ?? ""),
      /** Voice name — provider-specific; empty picks "marin" / "Puck". */
      voice: z.string().default(process.env.S2S_VOICE ?? ""),
      /** End the call after this long with nobody attached. 0 disables. */
      idleMs: z.number().default(10 * 60_000),
    }),
  )
  .output(
    z.object({
      roomId: z.string(),
      endedBecause: z.string(),
      durationMs: z.number(),
    }),
  )
  .timeout(S2S_ROOM_MAX_MS)
  .concurrency(S2S_ROOM_CONCURRENCY)
  .run(async (input) => {
    const startedAt = Date.now();
    const keyName = input.provider === "openai" ? "OPENAI_API_KEY" : "GEMINI_API_KEY";
    const apiKey = process.env[keyName];
    if (!apiKey) throw new Error(`${keyName} is not set. See .env.example.`);

    // Same queue the runner drains, so the research job this room dispatches
    // is picked up by the same station process.
    configure({ adapter: new SqliteAdapter({ dbPath: input.dbPath }) });

    // ── the caller's audio duct ──────────────────────────────────────────────
    const caller: { ws: WebSocket | null } = { ws: null };
    const send = (msg: ServerMessage) => {
      const ws = caller.ws;
      if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    };
    const sendAudio = (pcm: Int16Array) => {
      const ws = caller.ws;
      if (ws && ws.readyState === ws.OPEN) {
        ws.send(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer, {
          binary: true,
        });
      }
    };

    // ── the layered agents ───────────────────────────────────────────────────
    // Thin front (this room, driven by the S2S model) + capable worker (its
    // own research signal run). The mesh adapter's dispatch queues the job and
    // returns — Nova keeps the floor while the worker digs.
    // The agent definition carries its full realtime configuration on the
    // model slot (s2sDrivenModel): provider + model + voice from the room
    // input, credential resolved here, S2S_* env filling the rest.
    const front = buildS2SFrontAgent(new MemoryStore(`s2s_front_${input.roomId}`), {
      provider: input.provider,
      apiKey,
      ...(input.model ? { model: input.model } : {}),
      ...(input.voice ? { voice: input.voice } : {}),
    });
    const meshAdapter = new RoomMeshAdapter({
      dispatch: async ({ request, messageId }) => {
        const jobId = await research.trigger({
          request,
          messageId,
          roomId: input.roomId,
          replyUrl: `http://127.0.0.1:${input.port}/mesh`,
          meshToken: input.meshToken,
        });
        send({ t: "delegation", jobId, phase: "queued", detail: request });
        console.log(`delegated ${messageId} → run ${jobId}`);
        return jobId;
      },
    });
    await mountMesh(front, { adapter: meshAdapter, identity: FRONT_IDENTITY });

    // ── the realtime session ─────────────────────────────────────────────────
    // Everything voice-session.ts + turn-engine.ts did lives in the provider
    // now. The room's remaining job is plumbing: PCM through, transcripts to
    // the console, worker replies into the live conversation.
    // No adapter wiring: the provider session derives from the config the
    // agent's model slot carries. Both providers implement the same
    // transport-mode contract, so the room is identical from here down.
    const rt = new RealtimeAgent({
      agent: front,
      // Slim the spoken tool surface: send + list are useful mid-call, the
      // broadcast/ack verbs are not (two-agent mesh, and the transport's
      // acknowledge is deliberately inert anyway).
      excludeTools: ["glove_mesh_broadcast", "glove_mesh_acknowledge"],
    });

    let currentSpeaker: SpeakerRole = "operator";
    let turnId = 0;
    let turnOpen = false;

    rt.on("user_said", (text) => {
      send({ t: "utterance", speaker: currentSpeaker, text });
    });
    rt.on("agent_delta", (text) => {
      if (!turnOpen) {
        turnOpen = true;
        turnId += 1;
      }
      send({ t: "speech", turnId, text });
    });
    rt.on("agent_said", () => {
      if (turnOpen) {
        turnOpen = false;
        send({ t: "speech_end", turnId });
      }
    });
    rt.on("tool_started", (name) => send({ t: "metric", name: `tool:${name}` }));
    rt.on("error", (err) => {
      console.log(`realtime error: ${err.message}`);
      send({ t: "error", message: err.message });
    });

    rt.adapter.on("audio", (pcm, format) => {
      sendAudio(resample(pcm, format.sampleRate, SAMPLE_RATE));
    });
    rt.adapter.on("interrupted", () => {
      // Provider-native barge-in: drop whatever the browser has buffered.
      turnOpen = false;
      send({ t: "clear" });
    });
    rt.adapter.on("agent_speech_started", () =>
      send({ t: "state", listening: false, speaking: true, thinking: false }),
    );
    rt.adapter.on("agent_speech_stopped", () =>
      send({ t: "state", listening: true, speaking: false, thinking: false }),
    );
    rt.adapter.on("disconnected", () => {
      send({ t: "error", message: "the realtime session dropped" });
    });

    await rt.start();
    console.log(
      `${input.roomId}: realtime session up — ${rt.exposedTools.length} tools exposed to the voice model`,
    );

    // ── HTTP: health + the mesh inbound endpoint ─────────────────────────────
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      void (async () => {
        const url = new URL(req.url ?? "/", "http://localhost");

        if (url.pathname === "/health") {
          res.writeHead(200, {
            "Content-Type": "application/json",
            // The browser polls this cross-origin to know the room is ready.
            "Access-Control-Allow-Origin": "*",
          });
          res.end(
            JSON.stringify({
              ok: true,
              roomId: input.roomId,
              connected: Boolean(caller.ws && caller.ws.readyState === caller.ws.OPEN),
            }),
          );
          return;
        }

        // The worker's threaded reply, arriving from its own signal run. Two
        // things happen with it: the mesh adapter resolves the front agent's
        // pending mesh:waiting item (bookkeeping, exactly as the text room),
        // and the findings are INJECTED into the live realtime conversation
        // with respond: true — the §5 wakeup, spoken.
        if (url.pathname === "/mesh" && req.method === "POST") {
          if (req.headers["x-mesh-token"] !== input.meshToken) {
            res.writeHead(403).end("forbidden");
            return;
          }
          let body = "";
          for await (const chunk of req) body += chunk;
          try {
            const { message } = JSON.parse(body) as MeshEnvelope;
            await meshAdapter.deliver(message);
            rt.inject(`<worker-result>${message.content}</worker-result>`, { respond: true });
            send({ t: "delegation", jobId: message.id, phase: "done" });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
          } catch (err) {
            console.log(`bad mesh delivery: ${(err as Error)?.message}`);
            res.writeHead(400).end("bad request");
          }
          return;
        }

        res.writeHead(404).end("not found");
      })();
    });

    // ── WebSocket: the caller's audio duct ───────────────────────────────────
    const wss = new WebSocketServer({ server });
    wss.on("error", (err: Error) => console.log(`websocket server error: ${err.message}`));

    let lastDetachAt = Date.now();

    wss.on("connection", (ws: WebSocket) => {
      const prev = caller.ws;
      if (prev && prev.readyState === prev.OPEN) {
        prev.close(4000, "replaced by a new connection");
      }
      caller.ws = ws;
      console.log(`caller attached to ${input.roomId}`);
      send({
        t: "ready",
        sessionId: input.roomId,
        config: { mode: "s2s", provider: input.provider, model: input.model || "(default)" },
        speakers: SPEAKERS.map(({ id, displayName, description }) => ({ id, displayName, description })),
        assistantName: ASSISTANT_NAME,
      });

      ws.on("message", (data: Buffer, isBinary: boolean) => {
        if (isBinary) {
          // The duct captures at 16 kHz; the adapter declares what it wants
          // (Gemini 16 kHz — a straight pass — OpenAI 24 kHz).
          const mic = new Int16Array(
            data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
          );
          rt.sendAudio(resample(mic, SAMPLE_RATE, rt.adapter.inputFormat.sampleRate));
          return;
        }
        let msg: ClientMessage;
        try {
          msg = JSON.parse(data.toString()) as ClientMessage;
        } catch {
          return;
        }
        switch (msg.t) {
          case "speaker":
            currentSpeaker = msg.speaker as SpeakerRole;
            break;
          case "say":
            // Typed lines take the text side-channel into the live session.
            send({ t: "utterance", speaker: msg.speaker as SpeakerRole, text: msg.text });
            rt.inject(frameUtterance(msg.speaker as SpeakerRole, msg.text), { respond: true });
            break;
          case "barge_in":
            // The client's local reflex heard a person; make it official.
            rt.adapter.interrupt();
            break;
          case "playback_done":
            // The provider owns turn-taking; nothing gates on this here.
            break;
        }
      });

      const detach = () => {
        if (caller.ws !== ws) return;
        caller.ws = null;
        lastDetachAt = Date.now();
        console.log(`caller detached from ${input.roomId}`);
      };
      ws.on("close", detach);
      ws.on("error", detach);
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(input.port, () => resolve());
    });
    console.log(`${input.roomId} listening on :${input.port}`);

    // ── stay up until hung up, abandoned, or reaped ──────────────────────────
    const endedBecause = await new Promise<string>((resolve) => {
      const finish = (reason: string) => {
        clearInterval(idleTimer);
        resolve(reason);
      };
      const idleTimer = setInterval(() => {
        if (!input.idleMs || caller.ws) return;
        if (Date.now() - lastDetachAt > input.idleMs) finish("idle");
      }, 5_000);
      process.once("SIGTERM", () => finish("cancelled"));
      process.once("SIGINT", () => finish("cancelled"));
    });

    console.log(`${input.roomId} closing (${endedBecause})`);
    await rt.stop().catch(() => {});
    caller.ws?.close(1001, "room closing");
    wss.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));

    return { roomId: input.roomId, endedBecause, durationMs: Date.now() - startedAt };
  });
