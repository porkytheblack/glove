import type { IGloveRunnable } from "glove-core";
import type { AgentHandlerContext, FoundryRequest } from "glove-foundry";
import { RealtimeSession } from "glove-realtime";
import { openRoom } from "../../lib/room.js";

export function isLiveStart(request: FoundryRequest): boolean {
  return request.source?.kind === "direct"
    && (request.payload as { mode?: string } | undefined)?.mode === "live";
}

export async function runFront(agent: IGloveRunnable, ctx: AgentHandlerContext) {
  // Results received after the session closes use the normal text model and transcript.
  if (!isLiveStart(ctx.request)) return ctx.defaultRun();
  ctx.signal.throwIfAborted();
  const token = process.env.RESEARCH_ROOM_TOKEN;
  if (!token) throw new Error("RESEARCH_ROOM_TOKEN must be set by the start script.");
  const session = new RealtimeSession({
    agent, output: "text", persist: true, events: true,
    permissions: "deny", maxDurationMs: 30 * 60 * 1000,
    // Keep unrelated scheduling and workspace administration off this front.
    excludeTools: ["glove_foundry_spawn", "glove_foundry_background", "glove_foundry_sleep",
      "glove_foundry_schedule", "glove_foundry_schedules", "glove_foundry_shared_inbox",
      "glove_foundry_environment", "glove_foundry_tasks", "glove_foundry_workspace"],
  });
  let end!: () => void;
  const ended = new Promise<void>((resolve) => { end = resolve; });
  session.on("ended", end);
  const onAbort = () => { end(); void session.stop("cancelled").catch(() => {}); };
  ctx.signal.addEventListener("abort", onAbort, { once: true });
  if (ctx.signal.aborted) onAbort();
  let room: Awaited<ReturnType<typeof openRoom>> | undefined;
  session.on("error", (error) => {
    room?.publish("error", error.message);
    ctx.emit({ type: "research.front.error", data: { message: error.message } });
  });
  try {
    // start() holds Glove's turn queue and consumes native events for this session.
    await session.start();
    room = await openRoom(session, token, end, Number(process.env.RESEARCH_ROOM_PORT ?? 8787));
    session.on("agent_said", (text) => room!.publish("assistant", text));
    session.on("tool_started", ({ name }) => room!.publish("tool", name));
    ctx.emit({ type: "research.front.ready", data: { conversationId: ctx.conversationId, port: room.port } });
    await ended;
    return { ended: true };
  } finally {
    ctx.signal.removeEventListener("abort", onAbort);
    try { await session.stop(); } finally { await room?.close(); }
  }
}
