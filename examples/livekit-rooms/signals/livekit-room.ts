// ─────────────────────────────────────────────────────────────────────────────
// A LIVEKIT room — the s2s room with the hand-rolled duct deleted.
//
// The transport is now an ADAPTER (`glove-voice-livekit`), not example code:
// `LiveKitTransport` owns join/publish/subscribe/data + the server-side
// barge-in flush, `attachRealtime` binds it to the RealtimeAgent in one
// call, and the avatar catalogue joins the SAME room as a participant —
// `TavusLiveKitAvatar` / `AnamLiveKitAvatar` implement the exact
// `AvatarAdapter` contract the Daily-based echo adapter does, driven over
// LiveKit's avatar datastream protocol (byte streams + RPC).
//
//   browser ── LiveKit room ──▶ this signal joins as participant "agent"
//     mic track ───────────────▶ transport "audio" → rt.sendAudio
//     agent audio track ◀─────── transport.sendAudio (paced; clear() =
//     data channel ◀────────────  barge-in flush) ← rt.adapter "audio"
//     avatar A/V tracks ◀─────── the PROVIDER's worker, fed agent PCM over
//                                the lk.audio_stream byte stream (AVATAR=…)
//                                        │ glove_mesh_send_message
//                                        ▼
//                               research SIGNAL — the worker (unchanged)
//                                        │ threaded mesh reply
//   POST /mesh ◀────────────────────────┘ → rt.inject(…, { respond: true })
//
// With an avatar attached the agent does NOT publish its own audio track —
// the avatar worker publishes the synchronized voice+face on the agent's
// behalf (`lk.publish_on_behalf`), and publishing our own copy would double
// the audio. Barge-in chains through either way: provider VAD → S2S
// `interrupted` → transport flush + avatar `lk.clear_buffer` RPC.
// ─────────────────────────────────────────────────────────────────────────────

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { signal, z, configure } from "station-signal";
import { SqliteAdapter } from "station-adapter-sqlite";
import { dispose } from "@livekit/rtc-node";
import { MemoryStore } from "glove-core";
import { mountMesh } from "glove-mesh";
import { RealtimeAgent, type CreateS2SAdapterArgs } from "glove-voice-s2s";
import { attachAvatar, type AvatarAdapter } from "glove-voice-avatar";
import {
  ANAM_AVATAR_IDENTITY,
  AnamLiveKitAvatar,
  attachRealtime,
  LiveKitTransport,
  mintAvatarToken,
  mintParticipantToken,
  TAVUS_AVATAR_IDENTITY,
  TavusLiveKitAvatar,
} from "glove-voice-livekit";
import { research } from "./research";
import { buildS2SFrontAgent } from "../lib/s2s-front-agent";
import { FRONT_IDENTITY, RoomMeshAdapter, type MeshEnvelope } from "../lib/mesh-transport";
import type { ClientMessage, ServerMessage, SpeakerRole } from "../lib/protocol";
import { ASSISTANT_NAME, SPEAKERS, frameUtterance } from "../lib/speakers";

export const LIVEKIT_ROOM_CONCURRENCY = Number(process.env.ROOM_SLOTS ?? 4);
export const LIVEKIT_ROOM_MAX_MS = Number(process.env.ROOM_MAX_MS ?? 60 * 60_000);

const AGENT_IDENTITY = "agent";
const AVATAR_IDENTITIES = new Set([TAVUS_AVATAR_IDENTITY, ANAM_AVATAR_IDENTITY]);

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
      /** The agent's face: a LiveKit avatar worker joining this room. */
      avatar: z
        .enum(["none", "tavus", "anam"])
        .default((process.env.AVATAR_PROVIDER as "tavus" | "anam" | undefined) ?? "none"),
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
    const lkCreds = { apiKey: lkKey, apiSecret: lkSecret };

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

    // ── the LiveKit leg: one transport adapter ───────────────────────────────
    const transport = new LiveKitTransport({
      url: lkUrl,
      token: await mintParticipantToken(lkCreds, {
        roomName: input.roomId,
        identity: AGENT_IDENTITY,
        name: ASSISTANT_NAME,
        ttl: Math.ceil(LIVEKIT_ROOM_MAX_MS / 1000) + 300,
      }),
      // With a face attached, the avatar worker publishes the voice on the
      // agent's behalf — publishing our own track would double the audio.
      publishAgentAudio: input.avatar === "none",
    });
    await transport.connect();
    console.log(`${input.roomId}: joined LiveKit room as "${AGENT_IDENTITY}"`);

    const send = (msg: ServerMessage) => transport.sendData(msg);
    const detachRealtime = attachRealtime(rt, transport, {
      agentAudio: input.avatar === "none",
    });

    // ── the face, when asked for: a second participant in the same room ─────
    let avatar: AvatarAdapter | null = null;
    let detachAvatar: (() => void) | null = null;
    if (input.avatar === "tavus") {
      const tavusKey = process.env.TAVUS_API_KEY;
      const faceId = process.env.TAVUS_FACE_ID;
      if (!tavusKey || !faceId)
        throw new Error("AVATAR=tavus needs TAVUS_API_KEY and TAVUS_FACE_ID. See .env.example.");
      avatar = new TavusLiveKitAvatar({
        apiKey: tavusKey,
        faceId,
        ...(process.env.TAVUS_PAL_ID ? { palId: process.env.TAVUS_PAL_ID } : {}),
        livekitUrl: lkUrl,
        avatarToken: await mintAvatarToken(lkCreds, {
          roomName: input.roomId,
          identity: TAVUS_AVATAR_IDENTITY,
          onBehalfOf: AGENT_IDENTITY,
          ttl: Math.ceil(LIVEKIT_ROOM_MAX_MS / 1000) + 300,
        }),
        wire: transport.avatarWire(TAVUS_AVATAR_IDENTITY),
      });
    } else if (input.avatar === "anam") {
      const anamKey = process.env.ANAM_API_KEY;
      const avatarId = process.env.ANAM_AVATAR_ID;
      if (!anamKey || !avatarId)
        throw new Error("AVATAR=anam needs ANAM_API_KEY and ANAM_AVATAR_ID. See .env.example.");
      avatar = new AnamLiveKitAvatar({
        apiKey: anamKey,
        avatarId,
        name: ASSISTANT_NAME,
        livekitUrl: lkUrl,
        avatarToken: await mintAvatarToken(lkCreds, {
          roomName: input.roomId,
          identity: ANAM_AVATAR_IDENTITY,
          onBehalfOf: AGENT_IDENTITY,
          ttl: Math.ceil(LIVEKIT_ROOM_MAX_MS / 1000) + 300,
        }),
        wire: transport.avatarWire(ANAM_AVATAR_IDENTITY),
      });
    }
    if (avatar) {
      avatar.on("error", (err) => console.log(`avatar error: ${err.message}`));
      detachAvatar = await attachAvatar(rt, avatar); // connects the session too
      console.log(`${input.roomId}: ${input.avatar} avatar worker invited to the room`);
    }

    // ── presence, transcripts and typed lines over the data channel ──────────
    let remoteCount = 0;
    let lastDetachAt = Date.now();
    transport.on("participant_connected", (identity) => {
      if (AVATAR_IDENTITIES.has(identity)) return; // the face is not a caller
      remoteCount++;
      send({
        t: "ready",
        sessionId: input.roomId,
        config: {
          transport: "livekit",
          provider: input.provider,
          model: input.model || "(default)",
          ...(input.avatar !== "none" ? { avatar: input.avatar } : {}),
        },
        speakers: SPEAKERS.map(({ id, displayName, description }) => ({ id, displayName, description })),
        assistantName: ASSISTANT_NAME,
      });
    });
    transport.on("participant_disconnected", (identity) => {
      if (AVATAR_IDENTITIES.has(identity)) return;
      remoteCount = Math.max(0, remoteCount - 1);
      if (remoteCount === 0) lastDetachAt = Date.now();
    });

    let currentSpeaker: SpeakerRole = "operator";
    transport.on("data", (raw) => {
      const msg = raw as ClientMessage;
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
    rt.adapter.on("interrupted", () => send({ t: "clear" }));
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
    detachAvatar?.();
    detachRealtime();
    await avatar?.disconnect().catch(() => {});
    await rt.stop().catch(() => {});
    await transport.disconnect().catch(() => {});
    await dispose().catch(() => {});
    await new Promise<void>((resolve) => server.close(() => resolve()));

    return { roomId: input.roomId, endedBecause, durationMs: Date.now() - startedAt };
  });
