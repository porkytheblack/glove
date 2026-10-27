import { createServer } from "node:http";
import type { IGloveRunnable, Message, Tool } from "glove-core";
import { RealtimeAgent, type RealtimeAgentConfig } from "glove-voice-s2s";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import type { AgentHandlerContext } from "./definition.js";
import { renderMeshMessages, type FoundryMeshMessage } from "./mesh.js";

/**
 * Foundry tools that have no place in a spoken conversation. Durable,
 * long-running or bookkeeping work belongs to another agent, reached over the
 * mesh, not the call.
 */
export const VOICE_EXCLUDED_FOUNDRY_TOOLS: ReadonlyArray<string> = Object.freeze([
  "glove_foundry_spawn",
  "glove_foundry_sleep",
  "glove_foundry_background",
  "glove_foundry_schedules",
  "glove_foundry_conversations",
  "glove_foundry_workspace",
  "glove_foundry_shared_inbox",
  "glove_foundry_tasks",
  "glove_foundry_environment",
]);

/** How long a mesh message may wait for a pause in speech before it is spoken anyway. */
const MAX_UPDATE_HOLD_MS = 8_000;

/**
 * Where a call's audio comes from and goes to: a WebSocket the browser
 * connects to, a LiveKit room, a phone bridge. `voiceCall` starts the
 * realtime session, then hands it to the room.
 */
export interface FoundryVoiceRoom {
  /** Connect the session to callers. Call `joined()` and `left()` as they come and go. */
  open(call: FoundryVoiceCall): void | Promise<void>;
  /** The call is over: release ports and connections. */
  close(): void | Promise<void>;
}

export interface FoundryVoiceCall {
  /** The live session: feed it caller audio, listen to its `audio` and speech events. */
  readonly realtime: RealtimeAgent;
  readonly runId: string;
  /** Record an event on the run's trace. */
  readonly emit: (event: { type: string; data?: unknown }) => void;
  /** A caller connected. The first one hears the greeting. */
  joined(): void;
  /** A caller went away. The call ends after `idleMs` with nobody connected. */
  left(): void;
  /** The caller typed instead of speaking: saved to the transcript and answered. */
  say(text: string): void;
  /** Hang up now. */
  end(reason: string): void;
}

export interface VoiceCallOptions {
  /**
   * The room the call happens in. Rooms are usually per call (a port and a
   * token, a LiveKit room name), so this can be a function of the run.
   */
  readonly room:
    | FoundryVoiceRoom
    | ((context: AgentHandlerContext) => FoundryVoiceRoom | Promise<FoundryVoiceRoom>);
  /**
   * What to tell the model when the first caller joins, such as "Greet the
   * caller in one short sentence." Omit it to wait for the caller to speak.
   */
  readonly greeting?: string;
  /** End the call after this long with nobody connected. Default 2 minutes. */
  readonly idleMs?: number;
  /** End the call after this long in any case. Default 30 minutes. */
  readonly maxDurationMs?: number;
  /**
   * Wait this long after the session connects before opening the room. Some
   * providers confirm their setup just after the socket opens. Default 0.
   */
  readonly openDelayMs?: number;
  /** Save what both sides say to the conversation's store. Default true. */
  readonly transcript?: boolean;
  /**
   * Passed to RealtimeAgent: an explicit `adapter`, `voice`, `instructions`,
   * `excludeTools` (added to the defaults) and `onToolCall`.
   */
  readonly realtime?: Omit<RealtimeAgentConfig, "agent">;
  /** How a mesh message is put to the model mid-call. Return null to keep it silent. */
  readonly announce?: (message: FoundryMeshMessage) => string | null;
  /**
   * A run that is not a call: a reply from another agent that arrived after
   * the caller hung up. By default it is saved to the conversation, so the
   * next call starts knowing it.
   */
  readonly offCall?: (agent: IGloveRunnable, context: AgentHandlerContext) => unknown;
}

export interface VoiceCallResult {
  readonly endedBecause: string;
  readonly durationMs: number;
  /** How many times the agent spoke. */
  readonly turns: number;
  /** Mesh messages put to the caller during the call. */
  readonly updatesSpoken: number;
}

/** The default way a message from another agent is put to the model mid-call. */
export function announceMeshMessage(message: FoundryMeshMessage): string {
  const who = `${message.from.name} (${message.from.agentId})`;
  if (message.kind === "reply") {
    return [
      `${who} replied to what you sent them (thread ${message.threadId}):`,
      message.content,
      "Tell the caller what matters, briefly and in plain speech.",
    ].join("\n");
  }
  if (message.kind === "failed") {
    return [
      `${who} could not finish (thread ${message.threadId}): ${message.content}`,
      "Let the caller know, briefly.",
    ].join("\n");
  }
  return [
    `${who} asks (thread ${message.threadId}): ${message.content}`,
    `If you already know the answer, reply with glove_mesh_send_message to "${message.from.agentId}" with in_reply_to "${message.id}".`,
    "Otherwise ask the caller, then reply with their answer.",
  ].join("\n");
}

function gatedTools(agent: IGloveRunnable): string[] {
  return agent.tools
    .filter((tool) => (tool as Tool<unknown>).requiresPermission !== undefined && (tool as Tool<unknown>).requiresPermission !== false)
    .map((tool) => tool.name);
}

/**
 * Run an agent as a live voice call: use it as a definition's `run`.
 *
 * The agent's prompt, tools and context configure a realtime speech session
 * (its model must be `s2sDrivenModel(...)`, or pass `realtime.adapter`). The
 * room connects callers. What both sides say is saved to the conversation.
 * Replies and questions from other agents on the mesh are spoken at the next
 * pause instead of waiting for the call to end. Foundry's bookkeeping tools
 * and any tool that needs an approval are kept off the call; hand that work
 * to another agent instead.
 */
export function voiceCall(options: VoiceCallOptions) {
  return async (agent: IGloveRunnable, context: AgentHandlerContext): Promise<VoiceCallResult | unknown> => {
    if (context.request.source?.kind === "mesh") {
      if (options.offCall) return options.offCall(agent, context);
      await agent.store.appendMessages([{ sender: "user", text: context.messageText }]);
      return { endedBecause: "not a call", durationMs: 0, turns: 0, updatesSpoken: 0 } satisfies VoiceCallResult;
    }

    const startedAt = Date.now();
    const excludeTools = [...new Set([
      ...VOICE_EXCLUDED_FOUNDRY_TOOLS,
      ...gatedTools(agent),
      ...(options.realtime?.excludeTools ?? []),
    ])];
    const realtime = new RealtimeAgent({ ...options.realtime, agent, excludeTools });
    const keepTranscript = options.transcript !== false;
    let saving: Promise<void> = Promise.resolve();
    const save = (messages: Message[]): void => {
      if (!keepTranscript) return;
      saving = saving
        .then(() => agent.store.appendMessages(messages))
        .catch((cause: unknown) => {
          context.emit({
            type: "foundry.voice.transcript.error",
            data: { message: cause instanceof Error ? cause.message : String(cause) },
          });
        });
    };

    let turns = 0;
    let updatesSpoken = 0;
    let agentSpeaking = false;
    let userSpeaking = false;
    realtime.on("user_said", (text) => save([{ sender: "user", text }]));
    realtime.on("agent_said", (text) => {
      turns++;
      save([{ sender: "agent", text }]);
    });
    realtime.on("error", (error) => {
      context.emit({ type: "foundry.voice.error", data: { message: error.message } });
    });
    realtime.on("tool_started", (name) => context.emit({ type: "foundry.voice.tool", data: { name, phase: "start" } }));
    realtime.on("tool_finished", (name) => context.emit({ type: "foundry.voice.tool", data: { name, phase: "done" } }));

    // Mesh messages wait for a pause: never over the caller or the agent.
    const announce = options.announce ?? announceMeshMessage;
    const queue: FoundryMeshMessage[] = [];
    let heldSince = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const pump = (): void => {
      if (queue.length === 0 || !realtime.isConnected) return;
      const waited = Date.now() - heldSince;
      if ((agentSpeaking || userSpeaking) && waited < MAX_UPDATE_HOLD_MS) {
        if (!retry) {
          retry = setTimeout(() => {
            retry = undefined;
            pump();
          }, 250);
        }
        return;
      }
      const batch = queue.splice(0);
      // The full message joins the transcript, so later turns can use the details.
      save([{ sender: "user", text: renderMeshMessages(batch, (message) => (message.threadId === context.conversationId ? "recipient" : "starter")) }]);
      const text = batch.map(announce).filter((line): line is string => Boolean(line)).join("\n\n");
      if (text) realtime.inject(text, { respond: true });
      updatesSpoken += batch.length;
      context.emit({
        type: "foundry.voice.updates.spoken",
        data: { messageIds: batch.map((message) => message.id) },
      });
    };
    realtime.adapter.on("agent_speech_started", () => { agentSpeaking = true; });
    realtime.adapter.on("agent_speech_stopped", () => { agentSpeaking = false; pump(); });
    realtime.adapter.on("user_speech_started", () => { userSpeaking = true; });
    realtime.adapter.on("user_speech_stopped", () => { userSpeaking = false; pump(); });
    realtime.adapter.on("interrupted", () => { agentSpeaking = false; });
    const stopListening = context.onMeshMessage((messages) => {
      // A read receipt is for a tool that is waiting, not for the caller.
      const spoken = messages.filter((message) => message.kind !== "ack");
      if (spoken.length === 0) return;
      if (queue.length === 0) heldSince = Date.now();
      queue.push(...spoken);
      pump();
    });

    const room = typeof options.room === "function" ? await options.room(context) : options.room;
    const idleMs = options.idleMs ?? 120_000;
    const maxDurationMs = options.maxDurationMs ?? 30 * 60_000;
    let finish!: (reason: string) => void;
    const ended = new Promise<string>((resolveEnded) => {
      let done = false;
      finish = (reason) => {
        if (done) return;
        done = true;
        resolveEnded(reason);
      };
    });
    let connected = 0;
    let greeted = false;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const armIdle = (): void => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => finish("idle"), idleMs);
    };
    const call: FoundryVoiceCall = {
      realtime,
      runId: context.runId,
      emit: context.emit,
      joined() {
        connected++;
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = undefined;
        context.emit({ type: "foundry.voice.caller.joined", data: { connected } });
        if (!greeted && options.greeting) {
          greeted = true;
          realtime.inject(options.greeting, { respond: true });
        }
        pump();
      },
      left() {
        connected = Math.max(0, connected - 1);
        context.emit({ type: "foundry.voice.caller.left", data: { connected } });
        if (connected === 0) armIdle();
      },
      say(text) {
        save([{ sender: "user", text }]);
        realtime.inject(text, { respond: true });
      },
      end: (reason) => finish(reason),
    };
    const onAbort = (): void => finish("cancelled");
    const maxTimer = setTimeout(() => finish("time limit"), maxDurationMs);
    let started = false;
    try {
      await realtime.start();
      started = true;
      if (options.openDelayMs) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, options.openDelayMs));
      }
      await room.open(call);
      if (connected === 0) armIdle();
      context.signal.addEventListener("abort", onAbort, { once: true });
      if (context.signal.aborted) onAbort();
      context.emit({ type: "foundry.voice.call.open", data: { tools: realtime.exposedTools.map((tool) => tool.name) } });
      const endedBecause = await ended;
      context.emit({ type: "foundry.voice.call.ended", data: { endedBecause } });
      return { endedBecause, durationMs: Date.now() - startedAt, turns, updatesSpoken } satisfies VoiceCallResult;
    } finally {
      clearTimeout(maxTimer);
      if (idleTimer) clearTimeout(idleTimer);
      if (retry) clearTimeout(retry);
      context.signal.removeEventListener("abort", onAbort);
      await stopListening();
      // Messages nobody heard stay in the conversation for the next turn.
      if (queue.length > 0) {
        save([{ sender: "user", text: renderMeshMessages(queue.splice(0), (message) => (message.threadId === context.conversationId ? "recipient" : "starter")) }]);
      }
      try { await room.close(); } catch { /* the call is over either way */ }
      if (started) await realtime.stop().catch(() => undefined);
      await saving;
    }
  };
}

// ── A WebSocket room ─────────────────────────────────────────────────────────

/** Sent by the caller's page: typed text, or "stop talking". Audio is binary PCM16. */
export type VoiceRoomClientMessage =
  | { readonly t: "say"; readonly text: string }
  | { readonly t: "barge_in" };

/** Sent to the caller's page. Audio is binary PCM16 at the room's sample rate. */
export type VoiceRoomServerMessage =
  | { readonly t: "ready"; readonly sessionId: string; readonly agent: string; readonly model: string; readonly tools: ReadonlyArray<string> }
  | { readonly t: "utterance"; readonly text: string }
  | { readonly t: "speech"; readonly turnId: number; readonly text: string }
  | { readonly t: "speech_end"; readonly turnId: number }
  | { readonly t: "tool"; readonly name: string; readonly phase: "start" | "done" | "error" }
  | { readonly t: "state"; readonly state: "listening" | "thinking" | "speaking" }
  | { readonly t: "clear" }
  | { readonly t: "error"; readonly message: string };

export interface WebSocketRoomOptions {
  readonly port: number;
  /** Default 127.0.0.1. Put the room behind your own proxy to reach it from elsewhere. */
  readonly host?: string;
  /** Default "/call". */
  readonly path?: string;
  /** A caller connects with `?token=…`; anything else is refused. */
  readonly token: string;
  /** PCM16 mono sample rate on the wire. Default 16000. */
  readonly sampleRate?: number;
  /** Shown to the caller's page in the ready message. */
  readonly agentName?: string;
  readonly model?: string;
}

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

function bytes(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

/**
 * A call room a browser joins over one WebSocket: binary PCM16 both ways,
 * plus small JSON messages for captions, state and typed text. One caller at
 * a time; a new connection replaces the old. `GET /health` reports whether
 * someone is connected.
 */
export function webSocketRoom(options: WebSocketRoomOptions): FoundryVoiceRoom {
  const sampleRate = options.sampleRate ?? 16_000;
  const path = options.path ?? "/call";
  let server: ReturnType<typeof createServer> | undefined;
  let sockets: WebSocketServer | undefined;
  let caller: WebSocket | null = null;
  return {
    async open(call) {
      const { realtime } = call;
      const send = (message: VoiceRoomServerMessage): void => {
        if (caller?.readyState === 1) caller.send(JSON.stringify(message));
      };
      let turnId = 0;
      let turnOpen = false;
      realtime.on("user_said", (text) => send({ t: "utterance", text }));
      realtime.on("agent_delta", (text) => {
        if (!turnOpen) {
          turnOpen = true;
          turnId++;
        }
        send({ t: "speech", turnId, text });
      });
      realtime.on("agent_said", () => {
        if (!turnOpen) return;
        turnOpen = false;
        send({ t: "speech_end", turnId });
      });
      realtime.on("tool_started", (name) => send({ t: "tool", name, phase: "start" }));
      realtime.on("tool_finished", (name) => send({ t: "tool", name, phase: "done" }));
      realtime.on("error", (error) => send({ t: "error", message: error.message }));
      realtime.adapter.on("audio", (pcm, format) => {
        if (caller?.readyState !== 1) return;
        const out = resample(pcm, format.sampleRate, sampleRate);
        caller.send(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer, { binary: true });
      });
      realtime.adapter.on("interrupted", () => { turnOpen = false; send({ t: "clear" }); });
      realtime.adapter.on("user_speech_stopped", () => send({ t: "state", state: "thinking" }));
      realtime.adapter.on("agent_speech_started", () => send({ t: "state", state: "speaking" }));
      realtime.adapter.on("agent_speech_stopped", () => send({ t: "state", state: "listening" }));

      server = createServer((request, response) => {
        if (new URL(request.url ?? "/", "http://localhost").pathname !== "/health") {
          response.writeHead(404).end("not found");
          return;
        }
        response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        response.end(JSON.stringify({ ok: true, connected: Boolean(caller) }));
      });
      sockets = new WebSocketServer({ server, path });
      sockets.on("connection", (socket, request) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        if (url.searchParams.get("token") !== options.token) {
          socket.close(4403, "invalid room token");
          return;
        }
        const replaced = caller;
        caller = socket;
        if (replaced) {
          replaced.close(4400, "replaced by another caller");
          call.left();
        }
        call.joined();
        send({
          t: "ready",
          sessionId: call.runId,
          agent: options.agentName ?? "agent",
          model: options.model ?? "",
          tools: realtime.exposedTools.map((tool) => tool.name),
        });
        send({ t: "state", state: "listening" });
        socket.on("message", (data, isBinary) => {
          if (isBinary) {
            const chunk = bytes(data);
            const pcm = new Int16Array(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength));
            realtime.sendAudio(resample(pcm, sampleRate, realtime.adapter.inputFormat.sampleRate));
            return;
          }
          let message: VoiceRoomClientMessage;
          try {
            message = JSON.parse(data.toString()) as VoiceRoomClientMessage;
          } catch {
            send({ t: "error", message: "Ignored a message that was not JSON." });
            return;
          }
          if (message.t === "say" && message.text.trim()) {
            const text = message.text.trim();
            send({ t: "utterance", text });
            call.say(text);
          } else if (message.t === "barge_in") {
            realtime.adapter.interrupt();
          }
        });
        const detach = (): void => {
          if (caller !== socket) return;
          caller = null;
          call.left();
        };
        socket.on("close", detach);
        socket.on("error", detach);
      });
      await new Promise<void>((resolveListen, rejectListen) => {
        server!.once("error", rejectListen);
        server!.listen(options.port, options.host ?? "127.0.0.1", () => resolveListen());
      });
      call.emit({ type: "foundry.voice.room.ready", data: { port: options.port, path } });
    },
    async close() {
      caller?.close(1001, "call ended");
      caller = null;
      sockets?.close();
      if (server?.listening) await new Promise<void>((resolveClose) => server!.close(() => resolveClose()));
    },
  };
}
