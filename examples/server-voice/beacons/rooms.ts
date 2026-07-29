// ─────────────────────────────────────────────────────────────────────────────
// Rooms — durable, supervised, started on demand.
//
// A room IS a beacon: a long-lived process that owns one conversation. It takes
// microphone audio in over a WebSocket, runs the whole pipeline (VAD → STT →
// endpointing → front agent → TTS), and streams audio chunks back to whatever
// frontend is attached. It holds the front agent and its history, so the room
// outliving any single page load is the point — a reconnecting client rejoins
// the conversation already in progress.
//
// Station keys beacon instances by NAME, one instance per name, so rooms are a
// POOL of pre-registered slots (`room-1` … `room-N`). The Next.js app claims a
// free slot and starts it with per-room config:
//
//   POST /api/beacons/room-2/start   { "config": { "roomId": "...", "port": 4502 } }
//
// and releases it on hang-up:
//
//   POST /api/beacons/room-2/stop
//
// Everything a supervised process gets comes along for free: crash restart with
// backoff, heartbeat stall detection, graceful drain of the caller's socket,
// and a dashboard row per room showing incarnation, uptime and live logs.
// ─────────────────────────────────────────────────────────────────────────────

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { appendFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { beacon, z } from "station-beacon";
import { configure } from "station-signal";
import { SqliteAdapter } from "station-adapter-sqlite";
import { WebSocketServer, type WebSocket } from "ws";
import { research } from "../signals/research";
import { VoiceSession } from "../lib/voice-session";
import { warmEouScorer } from "../lib/turn-detector-local";
import type { MeshEnvelope } from "../lib/mesh-transport";
import type { ClientMessage, ServerMessage, SpeakerRole } from "../lib/protocol";

/** How many rooms can run at once. Each is a registered beacon slot. */
export const ROOM_SLOTS = 4;
/** room-N listens on BASE_PORT + N. */
export const BASE_PORT = 4500;

const RoomConfig = z.object({
  /** Opaque id for logs and metrics; the app generates it per session. */
  roomId: z.string().default("room"),
  port: z.number(),
  /** Proves an inbound /mesh POST belongs to a job this room dispatched. */
  meshToken: z.string().default("dev-token"),
  dbPath: z.string().default("./station.db"),
  metricsFile: z.string().default("./voice-metrics.jsonl"),
  voiceId: z.string().default("uYXf8XasLslADfZ2MB4u"),
  ttsModel: z.string().default("eleven_flash_v2_5"),
  /** Shut the room down after this long with nobody connected. Rooms are
   *  durable across reconnects, but not forever — an abandoned room should
   *  release its slot rather than idle. 0 disables. */
  idleShutdownMs: z.number().default(10 * 60_000),
});

function buildRoom(slot: number) {
  return (
    beacon(`room-${slot}`)
      .config(RoomConfig)
      // Rooms are claimed, not always-on: a slot sits stopped until the app
      // starts it with a caller's config. Without this every slot would boot
      // on discovery, each loading the endpointing model and holding a port.
      .manualStart()
      // But once claimed, a room that crashes mid-call comes straight back;
      // the client reconnects and the conversation continues.
      .restart("always")
      .backoff("1s", { max: "15s" })
      .heartbeat("10s")
      // Generous: the first room to start may download the endpointing weights.
      .startupTimeout(600_000)
      .run(async (ctx) => {
        const apiKey = process.env.ELEVENLABS_API_KEY;
        if (!apiKey) {
          ctx.log("ELEVENLABS_API_KEY is not set. See .env.example.");
          process.exit(78); // fatal: no amount of restarting conjures a key
        }

        // Same queue the signal runner drains, so the research job dispatched
        // from this child process is picked up by the runner in station.
        configure({ adapter: new SqliteAdapter({ dbPath: ctx.config.dbPath }) });

        try {
          const t0 = Date.now();
          await warmEouScorer();
          ctx.log(`end-of-utterance model ready in ${Date.now() - t0}ms`);
        } catch (err) {
          ctx.log(
            `end-of-utterance model unavailable (${(err as Error)?.message}) — ` +
              `falling back to heuristic endpointing`,
          );
        }

        const metricsPath = path.resolve(ctx.config.metricsFile);
        const metric = (
          name: string,
          ms?: number,
          data?: Record<string, unknown>,
          sessionId = ctx.config.roomId,
        ) => {
          const rec = {
            ts: new Date().toISOString(),
            roomId: ctx.config.roomId,
            sessionId,
            name,
            ...(ms != null ? { ms: Math.round(ms) } : {}),
            ...(data ? { data } : {}),
          };
          void appendFile(metricsPath, `${JSON.stringify(rec)}\n`).catch(() => {});
        };

        // ── the room's single conversation ───────────────────────────────────
        // Created once, for the life of the beacon — not per connection. A
        // client that drops and reconnects rejoins this same session, with the
        // front agent's history intact.
        let socket: WebSocket | null = null;
        const send = (msg: ServerMessage) => {
          if (socket && socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
        };

        const replyUrl = `http://127.0.0.1:${ctx.config.port}/mesh`;
        const session = new VoiceSession(ctx.config.roomId, {
          send,
          sendAudio: (pcm) => {
            if (socket && socket.readyState === socket.OPEN) socket.send(pcm, { binary: true });
          },
          metric,
          elevenLabsApiKey: apiKey,
          voiceId: ctx.config.voiceId,
          ttsModel: ctx.config.ttsModel,
          // Fire and forget: queue the research job and return. The answer
          // comes back over the mesh, not from this promise.
          dispatchResearch: async ({ request, messageId }) => {
            const jobId = await research.trigger({
              request,
              messageId,
              roomId: ctx.config.roomId,
              replyUrl,
              meshToken: ctx.config.meshToken,
            });
            ctx.log(`delegated ${messageId} → run ${jobId}`);
            return jobId;
          },
        });
        await session.start();

        // ── HTTP: health + the mesh inbound endpoint ─────────────────────────
        const server = createServer((req: IncomingMessage, res: ServerResponse) => {
          void (async () => {
            const url = new URL(req.url ?? "/", "http://localhost");

            if (url.pathname === "/health") {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({
                  ok: true,
                  roomId: ctx.config.roomId,
                  connected: Boolean(socket && socket.readyState === socket.OPEN),
                  incarnation: ctx.incarnation,
                }),
              );
              return;
            }

            // The worker's threaded reply, arriving from its signal process.
            if (url.pathname === "/mesh" && req.method === "POST") {
              if (req.headers["x-mesh-token"] !== ctx.config.meshToken) {
                res.writeHead(403).end("forbidden");
                return;
              }
              let body = "";
              for await (const chunk of req) body += chunk;
              try {
                const { message } = JSON.parse(body) as MeshEnvelope;
                await session.deliverMeshMessage(message);
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true }));
              } catch (err) {
                ctx.log(`bad mesh delivery: ${(err as Error)?.message}`);
                res.writeHead(400).end("bad request");
              }
              return;
            }

            res.writeHead(404).end("not found");
          })();
        });

        // ── WebSocket: the caller's audio duct ───────────────────────────────
        const wss = new WebSocketServer({ server });
        wss.on("error", (err: Error) => ctx.log(`websocket server error: ${err.message}`));

        let lastDisconnectAt = Date.now();

        wss.on("connection", (ws: WebSocket) => {
          // One caller per room. A second connection replaces the first rather
          // than interleaving two microphones into one conversation.
          if (socket && socket.readyState === socket.OPEN) {
            socket.close(4000, "replaced by a new connection");
          }
          socket = ws;
          ctx.log(`caller attached to ${ctx.config.roomId}`);
          session.attach();

          ws.on("message", (data: Buffer, isBinary: boolean) => {
            if (isBinary) {
              session.handleAudio(
                new Int16Array(
                  data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
                ),
              );
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
                session.setSpeaker(msg.speaker as SpeakerRole);
                break;
              case "say":
                session.handleTyped(msg.speaker as SpeakerRole, msg.text);
                break;
              case "playback_done":
                session.handlePlaybackDone(msg.turnId);
                break;
            }
          });

          const detach = () => {
            if (socket !== ws) return;
            socket = null;
            lastDisconnectAt = Date.now();
            session.detach();
            ctx.log(`caller detached from ${ctx.config.roomId}`);
          };
          ws.on("close", detach);
          ws.on("error", detach);
        });

        // ── liveness, idle reaping, graceful drain ───────────────────────────
        const beat = setInterval(() => {
          ctx.heartbeat();
          const idleMs = ctx.config.idleShutdownMs;
          if (!idleMs || socket) return;
          if (Date.now() - lastDisconnectAt > idleMs) {
            ctx.log(`idle for ${Math.round(idleMs / 1000)}s — releasing the room`);
            // Exit cleanly. `restart("always")` would bring it back, so ask the
            // supervisor to stop instead by exiting 0 after clearing desired
            // state is not available here — closing the server and letting the
            // handler return is the graceful path.
            void shutdown();
          }
        }, 5_000);

        let stopping = false;
        const shutdown = async () => {
          if (stopping) return;
          stopping = true;
          clearInterval(beat);
          session.close();
          socket?.close(1001, "room closing");
          wss.close();
          await new Promise<void>((resolve) => server.close(() => resolve()));
        };

        ctx.onStop(shutdown);

        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(ctx.config.port, () => resolve());
        });

        ctx.ready();
        ctx.log(`${ctx.config.roomId} listening on :${ctx.config.port}`);

        await ctx.untilStopped();
      })
  );
}

// One registered beacon per slot. Station discovers every exported beacon in
// this file, so the pool is declared simply by exporting it.
export const room1 = buildRoom(1);
export const room2 = buildRoom(2);
export const room3 = buildRoom(3);
export const room4 = buildRoom(4);

/** Deterministic port for a slot, so the app knows where to point the browser. */
export function portForSlot(slot: number): number {
  return BASE_PORT + slot;
}

export { randomUUID };
