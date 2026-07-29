// ─────────────────────────────────────────────────────────────────────────────
// A room — a long-lived SIGNAL run, not a beacon.
//
// A room owns one conversation: microphone audio in over a WebSocket, the whole
// pipeline (VAD → STT → endpointing → front agent → TTS), audio chunks back.
// It runs in its own child process for up to an hour, and ends when the caller
// hangs up, when it sits empty, or when the timeout reaps it.
//
// WHY A SIGNAL AND NOT A BEACON. Beacons are the natural fit for "supervised
// long-running process", and that is where this started. But beacon control
// lives only on station's DASHBOARD API, which authenticates with a session
// cookie — there are no beacon routes under `/api/v1`, so an API key cannot
// start or stop one. Rooms as signals put the entire lifecycle on the v1
// surface, where an API key works:
//
//   start    POST /api/v1/trigger            { signalName: "room", input }   scope: trigger
//   ready    GET  /api/v1/runs/:id                                           scope: read
//   hang up  POST /api/v1/runs/:id/cancel                                    scope: cancel
//
// So the web app holds one API key and nothing else. No session, no password.
//
// What this trades away, honestly: a beacon's `restart("always")` and heartbeat
// stall detection. A crashed room is a failed run, and the caller reconnects
// into a NEW room rather than a restarted one — which for a voice call is
// arguably clearer, since a silently restarted room would come back with an
// empty conversation anyway. What it gains, besides the auth story: every call
// becomes a Run with a duration, an outcome and its logs, and the pool is no
// longer a hand-registered set of named slots.
//
// Cancellation and timeout both arrive as SIGTERM to this process, so the
// shutdown path below is what makes a hang-up graceful.
// ─────────────────────────────────────────────────────────────────────────────

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { appendFile } from "node:fs/promises";
import path from "node:path";
import { signal, z, configure } from "station-signal";
import { SqliteAdapter } from "station-adapter-sqlite";
import { WebSocketServer, type WebSocket } from "ws";
import { research } from "./research";
import { VoiceSession } from "../lib/voice-session";
import { warmEouScorer } from "../lib/turn-detector-local";
import type { MeshEnvelope } from "../lib/mesh-transport";
import type { ClientMessage, ServerMessage, SpeakerRole } from "../lib/protocol";

/** How many rooms may run at once. Caps this signal only — research jobs have
 *  their own budget, so a full house never starves the worker. */
export const ROOM_CONCURRENCY = Number(process.env.ROOM_SLOTS ?? 4);
/** Hard ceiling on a single call. The runner SIGTERMs the process at this
 *  point, which the shutdown path turns into a clean close. */
export const ROOM_MAX_MS = Number(process.env.ROOM_MAX_MS ?? 60 * 60_000);

export const room = signal("room")
  .input(
    z.object({
      /** Opaque id for logs and metrics; the app generates one per call. */
      roomId: z.string(),
      /** Assigned by the app, which probes for a free one. */
      port: z.number(),
      /** Proves an inbound /mesh POST belongs to a job this room dispatched. */
      meshToken: z.string(),
      dbPath: z.string().default("./station.db"),
      metricsFile: z.string().default("./voice-metrics.jsonl"),
      voiceId: z.string().default("uYXf8XasLslADfZ2MB4u"),
      ttsModel: z.string().default("eleven_flash_v2_5"),
      /** End the call after this long with nobody attached. Rooms survive a
       *  reconnect, but an abandoned one should not hold a slot for the full
       *  hour. 0 disables. */
      idleMs: z.number().default(10 * 60_000),

      // ── endpointing ──────────────────────────────────────────────────────
      // How long after you stop talking before the room commits your turn.
      // Defaults come from env so they can be tuned in .env.local without
      // touching code — the right values depend on the room and how the
      // speaker paces.
      /** Trailing silence before the VAD calls end-of-speech. The floor of
       *  send latency: nothing starts until this has passed. */
      vadSilenceMs: z.number().default(Number(process.env.VAD_SILENCE_MS ?? 450)),
      /** Which VAD decides speech boundaries. Default is the neural Silero
       *  model; "energy" forces the zero-dependency RMS fallback. */
      vad: z.string().default(process.env.VOICE_VAD ?? "silero"),
      /** Energy-VAD only: RMS above which a frame counts as speech. */
      vadThreshold: z.number().default(Number(process.env.VAD_THRESHOLD ?? 0.006)),
      /** Hold when the end-of-utterance model is confident you are done. */
      minHoldMs: z.number().default(Number(process.env.TURN_MIN_HOLD_MS ?? 400)),
      /** …and when it is confident you are not. */
      maxHoldMs: z.number().default(Number(process.env.TURN_MAX_HOLD_MS ?? 2800)),
    }),
  )
  .output(
    z.object({
      roomId: z.string(),
      endedBecause: z.string(),
      durationMs: z.number(),
    }),
  )
  .timeout(ROOM_MAX_MS)
  .concurrency(ROOM_CONCURRENCY)
  .run(async (input) => {
    const startedAt = Date.now();
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set. See .env.example.");

    // Same queue the runner drains, so the research job this room dispatches is
    // picked up by the same station process.
    configure({ adapter: new SqliteAdapter({ dbPath: input.dbPath }) });

    try {
      const t0 = Date.now();
      await warmEouScorer();
      console.log(`end-of-utterance model ready in ${Date.now() - t0}ms`);
    } catch (err) {
      console.log(
        `end-of-utterance model unavailable (${(err as Error)?.message}) — ` +
          `falling back to heuristic endpointing`,
      );
    }

    const metricsPath = path.resolve(input.metricsFile);
    const metric = (name: string, ms?: number, data?: Record<string, unknown>) => {
      const rec = {
        ts: new Date().toISOString(),
        roomId: input.roomId,
        sessionId: input.roomId,
        name,
        ...(ms != null ? { ms: Math.round(ms) } : {}),
        ...(data ? { data } : {}),
      };
      void appendFile(metricsPath, `${JSON.stringify(rec)}\n`).catch(() => {});
    };

    // ── the room's single conversation ───────────────────────────────────────
    // Created once for the life of the run, not per connection, so a client
    // that drops and reconnects rejoins with the agent's history intact.
    // Boxed so the reference survives the long await below — TypeScript
    // otherwise narrows `socket` to null at the shutdown path.
    const caller: { ws: WebSocket | null } = { ws: null };
    const send = (msg: ServerMessage) => {
      const ws = caller.ws;
      if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    };

    const replyUrl = `http://127.0.0.1:${input.port}/mesh`;
    const session = new VoiceSession(input.roomId, {
      send,
      sendAudio: (pcm) => {
        const ws = caller.ws;
        if (ws && ws.readyState === ws.OPEN) ws.send(pcm, { binary: true });
      },
      metric,
      elevenLabsApiKey: apiKey,
      voiceId: input.voiceId,
      ttsModel: input.ttsModel,
      endpointing: {
        vad: input.vad,
        vadSilenceMs: input.vadSilenceMs,
        vadThreshold: input.vadThreshold,
        minHoldMs: input.minHoldMs,
        maxHoldMs: input.maxHoldMs,
      },
      // Fire and forget: queue the research job and return. The answer comes
      // back over the mesh, not from this promise.
      dispatchResearch: async ({ request, messageId }) => {
        const jobId = await research.trigger({
          request,
          messageId,
          roomId: input.roomId,
          replyUrl,
          meshToken: input.meshToken,
        });
        console.log(`delegated ${messageId} → run ${jobId}`);
        return jobId;
      },
    });
    await session.start();

    // ── HTTP: health + the mesh inbound endpoint ─────────────────────────────
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      void (async () => {
        const url = new URL(req.url ?? "/", "http://localhost");

        if (url.pathname === "/health") {
          res.writeHead(200, {
            "Content-Type": "application/json",
            // The BROWSER polls this to know when the room is ready, and it is
            // always cross-origin: the app is served from :3000 while each room
            // binds its own port. Without this header the response arrives
            // (200) but the browser refuses to let the page read it, so the
            // poll never succeeds and Connect hangs on "starting the room…".
            //
            // Safe to open: it is read-only, unauthenticated, and says nothing
            // a caller cannot already see. `/mesh` below stays closed.
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

        // The worker's threaded reply, arriving from its own signal run.
        if (url.pathname === "/mesh" && req.method === "POST") {
          if (req.headers["x-mesh-token"] !== input.meshToken) {
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
      // One caller per room. A second connection replaces the first rather than
      // interleaving two microphones into one conversation.
      const prev = caller.ws;
      if (prev && prev.readyState === prev.OPEN) {
        prev.close(4000, "replaced by a new connection");
      }
      caller.ws = ws;
      console.log(`caller attached to ${input.roomId}`);
      session.attach();

      ws.on("message", (data: Buffer, isBinary: boolean) => {
        if (isBinary) {
          session.handleAudio(
            new Int16Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)),
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
        if (caller.ws !== ws) return;
        caller.ws = null;
        lastDetachAt = Date.now();
        session.detach();
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
    //
    // A cancel (hang-up) and the run timeout both arrive as SIGTERM, so that
    // handler is what makes both paths graceful: sockets closed, agent torn
    // down, run resolved with a reason instead of a killed process.
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
    session.close();
    caller.ws?.close(1001, "room closing");
    wss.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));

    return { roomId: input.roomId, endedBecause, durationMs: Date.now() - startedAt };
  });
