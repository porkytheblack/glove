// ─────────────────────────────────────────────────────────────────────────────
// A LIVEKIT room — the s2s room with the hand-rolled duct deleted.
//
// The previous rooms carried audio over a bespoke WebSocket duct: worklets in
// the browser, 16 kHz PCM frames, a pause/resume/clear protocol, a local VAD
// reflex. LiveKit replaces ALL of it with standard WebRTC primitives, and the
// signal keeps what was never the duct's job: owning the conversation's
// lifecycle, the agents, and the mesh.
//
//   browser ── LiveKit room ──▶ this signal joins as participant "agent"
//     mic track ───────────────▶ AudioStream frames → resample → rt.sendAudio
//     agent audio track ◀─────── AudioSource.captureFrame (paced; clearQueue
//     data channel ◀────────────  = barge-in flush) ← rt.adapter "audio"
//       transcripts / typed lines / delegation notices, as JSON data packets
//                                        │ glove_mesh_send_message
//                                        ▼
//                               research SIGNAL — the worker (unchanged)
//                                        │ threaded mesh reply
//   POST /mesh ◀────────────────────────┘ → rt.inject(…, { respond: true })
//
// What the division buys, stated plainly:
//   - The client shrinks to a LiveKit join: no worklets, no local VAD, no
//     custom framing. Echo cancellation, jitter, and A/V sync are LiveKit's.
//   - Barge-in is server-authoritative and simple: the provider hears the
//     mic track continuously; `interrupted` clears the outbound audio queue.
//     There is no client playback buffer to chase.
//   - The avatar catalogue (Tavus, Anam, …) can join the same room as a
//     video participant — the follow-up milestone on #72.
//   - The signal still owns supervision (rooms-as-signals), the mesh still
//     owns delegation. LiveKit owns only the pipes.
// ─────────────────────────────────────────────────────────────────────────────

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { signal, z, configure } from "station-signal";
import { SqliteAdapter } from "station-adapter-sqlite";
import {
  AudioFrame,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  Room,
  RoomEvent,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
  dispose,
  type RemoteTrack,
} from "@livekit/rtc-node";
import { AccessToken } from "livekit-server-sdk";
import { MemoryStore } from "glove-core";
import { mountMesh } from "glove-mesh";
import { RealtimeAgent, type CreateS2SAdapterArgs } from "glove-voice-s2s";
import { research } from "./research";
import { buildS2SFrontAgent } from "../lib/s2s-front-agent";
import { FRONT_IDENTITY, RoomMeshAdapter, type MeshEnvelope } from "../lib/mesh-transport";
import type { ClientMessage, ServerMessage, SpeakerRole } from "../lib/protocol";
import { ASSISTANT_NAME, SPEAKERS, frameUtterance } from "../lib/speakers";

export const LIVEKIT_ROOM_CONCURRENCY = Number(process.env.ROOM_SLOTS ?? 4);
export const LIVEKIT_ROOM_MAX_MS = Number(process.env.ROOM_MAX_MS ?? 60 * 60_000);

/** The one rate the agent leg speaks. Both realtime providers emit 24 kHz. */
const AGENT_RATE = 24_000;

/** Linear resample — the mic arrives at LiveKit's rate (48 kHz), the S2S
 *  provider wants its declared inputFormat; and vice-versa on stray agent
 *  rates. Speech-grade is fine here. */
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

export const livekitRoom = signal("livekit-room")
  .input(
    z.object({
      roomId: z.string(),
      /** For /health and /mesh — the AV path needs no port at all. */
      port: z.number(),
      meshToken: z.string(),
      dbPath: z.string().default("./station.db"),
      provider: z
        .enum(["openai", "gemini"])
        .default(
          (process.env.S2S_PROVIDER as "openai" | "gemini" | undefined) ??
            (process.env.OPENAI_API_KEY ? "openai" : "gemini"),
        ),
      model: z.string().default(process.env.S2S_MODEL ?? ""),
      voice: z.string().default(process.env.S2S_VOICE ?? ""),
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
  .timeout(LIVEKIT_ROOM_MAX_MS)
  .concurrency(LIVEKIT_ROOM_CONCURRENCY)
  .run(async (input) => {
    const startedAt = Date.now();
    const keyName = input.provider === "openai" ? "OPENAI_API_KEY" : "GEMINI_API_KEY";
    const apiKey = process.env[keyName];
    if (!apiKey) throw new Error(`${keyName} is not set. See .env.example.`);
    const lkUrl = process.env.LIVEKIT_URL;
    const lkKey = process.env.LIVEKIT_API_KEY;
    const lkSecret = process.env.LIVEKIT_API_SECRET;
    if (!lkUrl || !lkKey || !lkSecret) {
      throw new Error("LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set. See .env.example.");
    }

    configure({ adapter: new SqliteAdapter({ dbPath: input.dbPath }) });

    // ── the layered agents (identical to s2s-rooms) ──────────────────────────
    const shared = {
      apiKey,
      ...(input.model ? { model: input.model } : {}),
      ...(input.voice ? { voice: input.voice } : {}),
    };
    const s2s: CreateS2SAdapterArgs =
      input.provider === "openai"
        ? {
            provider: "openai",
            ...shared,
            ...(process.env.S2S_TURN_DETECTION
              ? {}
              : { turnDetection: { type: "server_vad", silence_duration_ms: 450, prefix_padding_ms: 300 } }),
          }
        : {
            provider: "gemini",
            ...shared,
            realtimeInput: {
              automaticActivityDetection: {
                startOfSpeechSensitivity: "START_SENSITIVITY_HIGH",
                endOfSpeechSensitivity: "END_SENSITIVITY_HIGH",
                prefixPaddingMs: 300,
                silenceDurationMs: 450,
              },
            },
          };
    const front = buildS2SFrontAgent(new MemoryStore(`lk_front_${input.roomId}`), s2s);
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

    const rt = new RealtimeAgent({
      agent: front,
      excludeTools: ["glove_mesh_broadcast", "glove_mesh_acknowledge"],
    });

    // ── the LiveKit leg ──────────────────────────────────────────────────────
    const room = new Room();
    const agentToken = new AccessToken(lkKey, lkSecret, {
      identity: "agent",
      name: ASSISTANT_NAME,
      ttl: Math.ceil(LIVEKIT_ROOM_MAX_MS / 1000) + 300,
    });
    agentToken.addGrant({
      roomJoin: true,
      room: input.roomId,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    await room.connect(lkUrl, await agentToken.toJwt(), { autoSubscribe: true, dynacast: false });
    console.log(`${input.roomId}: joined LiveKit room as "agent"`);

    // Server messages ride the data channel as reliable JSON packets.
    const encoder = new TextEncoder();
    const send = (msg: ServerMessage) => {
      void room.localParticipant
        ?.publishData(encoder.encode(JSON.stringify(msg)), { reliable: true })
        .catch(() => {});
    };

    // Agent speech OUT: paced by AudioSource's internal queue — captureFrame
    // applies backpressure, so bursty provider audio plays at realtime, and
    // clearQueue() IS the barge-in flush (no client buffer to chase).
    const source = new AudioSource(AGENT_RATE, 1);
    const agentTrack = LocalAudioTrack.createAudioTrack("agent-voice", source);
    await room.localParticipant?.publishTrack(
      agentTrack,
      new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }),
    );
    let captureChain = Promise.resolve();
    rt.adapter.on("audio", (pcm, format) => {
      const at24k = resample(pcm, format.sampleRate, AGENT_RATE);
      const frame = new AudioFrame(at24k, AGENT_RATE, 1, at24k.length);
      captureChain = captureChain.then(() => source.captureFrame(frame)).catch(() => {});
    });
    rt.adapter.on("interrupted", () => {
      source.clearQueue();
      send({ t: "clear" });
    });

    // Caller mic IN: every remote audio track feeds the S2S model.
    const stopReaders: Array<() => void> = [];
    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      if (track.kind !== TrackKind.KIND_AUDIO) return;
      let live = true;
      stopReaders.push(() => {
        live = false;
      });
      void (async () => {
        const stream = new AudioStream(track);
        for await (const frame of stream) {
          if (!live) break;
          rt.sendAudio(resample(frame.data, frame.sampleRate, rt.adapter.inputFormat.sampleRate));
        }
      })().catch((err) => console.log(`mic stream ended: ${(err as Error)?.message}`));
    });

    let remoteCount = 0;
    let lastDetachAt = Date.now();
    room.on(RoomEvent.ParticipantConnected, () => {
      remoteCount++;
      send({
        t: "ready",
        sessionId: input.roomId,
        config: { transport: "livekit", provider: input.provider, model: input.model || "(default)" },
        speakers: SPEAKERS.map(({ id, displayName, description }) => ({ id, displayName, description })),
        assistantName: ASSISTANT_NAME,
      });
    });
    room.on(RoomEvent.ParticipantDisconnected, () => {
      remoteCount = Math.max(0, remoteCount - 1);
      if (remoteCount === 0) lastDetachAt = Date.now();
    });

    // Typed lines and speaker switches arrive as client data packets.
    let currentSpeaker: SpeakerRole = "operator";
    const decoder = new TextDecoder();
    room.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(decoder.decode(payload)) as ClientMessage;
      } catch {
        return;
      }
      switch (msg.t) {
        case "speaker":
          currentSpeaker = msg.speaker as SpeakerRole;
          break;
        case "say":
          send({ t: "utterance", speaker: msg.speaker as SpeakerRole, text: msg.text });
          rt.inject(frameUtterance(msg.speaker as SpeakerRole, msg.text), { respond: true });
          break;
        case "barge_in":
          rt.adapter.interrupt();
          break;
        default:
          break;
      }
    });

    // Transcripts and state, mirrored onto the data channel.
    let turnId = 0;
    let turnOpen = false;
    rt.on("user_said", (text) => send({ t: "utterance", speaker: currentSpeaker, text }));
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
    rt.adapter.on("agent_speech_started", () =>
      send({ t: "state", listening: false, speaking: true, thinking: false }),
    );
    rt.adapter.on("agent_speech_stopped", () =>
      send({ t: "state", listening: true, speaking: false, thinking: false }),
    );

    await rt.start();
    console.log(
      `${input.roomId}: realtime session up — ${rt.exposedTools.length} tools exposed to the voice model`,
    );

    // ── HTTP: health + the mesh inbound endpoint (unchanged) ─────────────────
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      void (async () => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.pathname === "/health") {
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          });
          res.end(JSON.stringify({ ok: true, roomId: input.roomId, connected: remoteCount > 0 }));
          return;
        }
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
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(input.port, () => resolve());
    });
    console.log(`${input.roomId} listening on :${input.port} (health + mesh)`);

    // ── stay up until hung up, abandoned, or reaped ──────────────────────────
    const endedBecause = await new Promise<string>((resolve) => {
      const finish = (reason: string) => {
        clearInterval(idleTimer);
        resolve(reason);
      };
      const idleTimer = setInterval(() => {
        if (!input.idleMs || remoteCount > 0) return;
        if (Date.now() - lastDetachAt > input.idleMs) finish("idle");
      }, 5_000);
      process.once("SIGTERM", () => finish("cancelled"));
      process.once("SIGINT", () => finish("cancelled"));
    });

    console.log(`${input.roomId} closing (${endedBecause})`);
    for (const stop of stopReaders) stop();
    await rt.stop().catch(() => {});
    await room.disconnect().catch(() => {});
    await dispose().catch(() => {});
    await new Promise<void>((resolve) => server.close(() => resolve()));

    return { roomId: input.roomId, endedBecause, durationMs: Date.now() - startedAt };
  });
