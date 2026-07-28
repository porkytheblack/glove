// ─────────────────────────────────────────────────────────────────────────────
// The voice gateway — a station BEACON.
//
// Why a beacon and not a route handler: a voice session is a long-lived,
// stateful duplex connection. It cannot live in a serverless function, and it
// should not live in a bare `node server.js` either — something has to keep it
// up. That is exactly what a beacon is: the supervisor spawns it in its own
// child process, restarts it on crash with exponential backoff, kills and
// restarts it if it stops heartbeating, and drains it gracefully on shutdown.
//
// So the operational story for a voice system comes for free:
//   • `restart("always")` — the gateway is back within a second of a crash.
//   • `.heartbeat("10s")` — a wedged event loop (a pathological ONNX call, a
//     stuck socket) is detected and recycled instead of silently accepting
//     connections it will never serve.
//   • `.startupTimeout()` — a boot that never finishes binding is caught.
//   • `ctx.onStop` — in-flight callers get their sockets closed politely
//     rather than having the process yanked out from under them.
//   • The station dashboard shows incarnation, restart count, uptime and live
//     logs for the voice tier next to the delegation jobs it dispatches.
// ─────────────────────────────────────────────────────────────────────────────

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { appendFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { beacon, z } from "station-beacon";
import { configure, getAdapter } from "station-signal";
import { SqliteAdapter } from "station-adapter-sqlite";
import { WebSocketServer, type WebSocket } from "ws";
import { research } from "../signals/research";
import { VoiceSession } from "../lib/voice-session";
import { warmEouScorer } from "../lib/turn-detector-local";
import type { ClientMessage, ServerMessage, SpeakerRole } from "../lib/protocol";

const PUBLIC_DIR = path.join(import.meta.dirname, "..", "public");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".ico": "image/x-icon",
};

export const voiceGateway = beacon("voice-gateway")
  .config(
    z.object({
      port: z.number().default(4500),
      dbPath: z.string().default("./station.db"),
      metricsFile: z.string().default("./voice-metrics.jsonl"),
      voiceId: z.string().default("uYXf8XasLslADfZ2MB4u"),
      ttsModel: z.string().default("eleven_flash_v2_5"),
      /** Poll interval for delegated job completion. */
      delegationPollMs: z.number().default(250),
    }),
  )
  .restart("always")
  .backoff("1s", { max: "15s" })
  .heartbeat("10s")
  // Generous: the first boot may download the end-of-utterance weights.
  .startupTimeout(600_000)
  .run(async (ctx) => {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      // Fatal, not restartable — no amount of retrying conjures an API key.
      ctx.log("ELEVENLABS_API_KEY is not set. See .env.example.");
      process.exit(78);
    }

    // Same database the SignalRunner drains, so `research.trigger()` from this
    // child process lands on the queue the runner is watching.
    configure({ adapter: new SqliteAdapter({ dbPath: ctx.config.dbPath }) });
    const adapter = getAdapter();

    // Load the end-of-utterance model BEFORE serving, so the first caller
    // doesn't pay for it. A failure here is not fatal: LocalTurnDetector falls
    // back to the heuristic tiers, which is worse but entirely functional.
    const warmAt = Date.now();
    try {
      await warmEouScorer();
      ctx.log(`end-of-utterance model ready in ${Date.now() - warmAt}ms`);
    } catch (err) {
      ctx.log(
        `end-of-utterance model unavailable (${(err as Error)?.message}) — ` +
          `falling back to heuristic endpointing`,
      );
    }

    const metricsPath = path.resolve(ctx.config.metricsFile);
    const sessions = new Set<VoiceSession>();

    // ── HTTP: serve the (very small) client ──────────────────────────────────
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      void (async () => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.pathname === "/health") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, sessions: sessions.size }));
          return;
        }
        const rel = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
        const file = path.join(PUBLIC_DIR, rel);
        // Refuse anything that escapes the public directory.
        if (!file.startsWith(PUBLIC_DIR)) {
          res.writeHead(403).end("forbidden");
          return;
        }
        try {
          const body = await readFile(file);
          res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" });
          res.end(body);
        } catch {
          res.writeHead(404).end("not found");
        }
      })();
    });

    // ── WebSocket: one session per connection ────────────────────────────────
    const wss = new WebSocketServer({ server });
    // The WebSocket server re-emits the HTTP server's errors. Without a
    // listener here, a bind failure becomes an unhandled 'error' event and
    // takes the process down with a stack trace instead of a message the
    // supervisor can act on.
    wss.on("error", (err: Error) => ctx.log(`websocket server error: ${err.message}`));

    wss.on("connection", (ws: WebSocket) => {
      const id = `s_${randomUUID().slice(0, 8)}`;
      const send = (msg: ServerMessage) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      };
      const metric = (name: string, ms?: number, data?: Record<string, unknown>) => {
        const rec = {
          ts: new Date().toISOString(),
          sessionId: id,
          name,
          ...(ms != null ? { ms: Math.round(ms) } : {}),
          ...(data ? { data } : {}),
        };
        void appendFile(metricsPath, `${JSON.stringify(rec)}\n`).catch(() => {});
        send({ t: "metric", name, ms, data });
      };

      const session = new VoiceSession(id, {
        send,
        sendAudio: (pcm) => {
          if (ws.readyState === ws.OPEN) ws.send(pcm, { binary: true });
        },
        metric,
        elevenLabsApiKey: apiKey,
        voiceId: ctx.config.voiceId,
        ttsModel: ctx.config.ttsModel,
        delegate: (request, sessionId) => research.trigger({ request, sessionId }),
        awaitDelegation: (jobId) => awaitRun(jobId),
      });
      sessions.add(session);
      ctx.log(`session ${id} connected (${sessions.size} active)`);

      ws.on("message", (data: Buffer, isBinary: boolean) => {
        if (isBinary) {
          // Raw PCM16 from the microphone. Buffer → Int16Array without a copy
          // when the offset allows it.
          const pcm = new Int16Array(
            data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
          );
          session.handleAudio(pcm);
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

      const cleanup = () => {
        if (!sessions.has(session)) return;
        sessions.delete(session);
        session.close();
        ctx.log(`session ${id} closed (${sessions.size} active)`);
      };
      ws.on("close", cleanup);
      ws.on("error", cleanup);

      void session.start().catch((err: Error) => {
        send({ t: "error", message: err.message });
        ctx.log(`session ${id} failed to start: ${err.message}`);
        ws.close();
      });
    });

    /** Watch a queued research job to completion by polling the shared queue. */
    async function awaitRun(jobId: string): Promise<{ answer: string } | { error: string }> {
      for (;;) {
        if (ctx.signal.aborted) return { error: "gateway shutting down" };
        const run = await adapter.getRun(jobId);
        if (!run) return { error: "job disappeared from the queue" };
        if (run.status === "completed") {
          try {
            const out = JSON.parse(run.output ?? "{}") as { answer?: string };
            return out.answer ? { answer: out.answer } : { error: "worker returned no answer" };
          } catch {
            return { error: "worker output was unreadable" };
          }
        }
        if (run.status === "failed") return { error: run.error ?? "the lookup failed" };
        if (run.status === "cancelled") return { error: "the lookup was cancelled" };
        await sleep(ctx.config.delegationPollMs, ctx.signal);
      }
    }

    // ── liveness + graceful drain ────────────────────────────────────────────
    const beat = setInterval(() => ctx.heartbeat(), 5_000);

    ctx.onStop(async () => {
      clearInterval(beat);
      for (const s of sessions) s.close();
      sessions.clear();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(ctx.config.port, () => resolve());
    });

    ctx.ready();
    ctx.log(`voice gateway listening on http://localhost:${ctx.config.port}`);

    await ctx.untilStopped();
  });

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
