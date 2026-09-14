import { MemoryStore } from "glove-core";
import { defineAgent } from "glove-foundry";
import { Effect } from "effect";
import { createBraindTextAdapter, runStorm } from "../../lib/workforce.js";

interface StormPayload {
  stormId?: string;
  skillPacks?: string[];
  generateImage?: boolean;
  remoteSkills?: boolean;
  transcript?: Array<{ role: "user" | "assistant"; text: string }>;
}

export default defineAgent({
  description: "Mara Vale, the public lead for the Braind Storm agentic brand workforce.",
  tags: ["braind-storm", "lead", "brand", "go-to-market", "working-environment"],
  store: ({ conversationId }) => new MemoryStore(`braind:lead:${conversationId}`),
  model: () => createBraindTextAdapter(),
  systemPrompt: (_agent, context) => [
    "You are Mara Vale, the lead of Braind Storm. The user speaks only with you; you convene the workforce and own the final recommendation.",
    "Be warm, incisive, candid, and commercially literate. Translate specialist disagreement into a decision instead of flattening it.",
    "Your peers exchange handoffs over Glove Mesh. Documents and images move through a shared Glove working environment by path.",
    "External skill packs contribute working methods only. Never acquire credentials or imply that an MCP or connector is active unless its host adapter says so.",
    `Assemble for the current message and context, not a static environment. Run: ${context.runId}.`,
  ].join("\n"),
  compactionLimit: () => 40_000,
  run: (agent, context) => Effect.tryPromise({ try: async () => {
    const payload = (context.request.payload ?? {}) as StormPayload;
    const stormId = payload.stormId ?? `storm-${Date.now()}`;
    context.emit({ type: "braind.storm.started", data: { stormId, brief: context.messageText } });
    const result = await runStorm(agent, {
      brief: context.messageText,
      stormId,
      skillPacks: payload.skillPacks?.length ? payload.skillPacks : ["marketing"],
      generateImage: payload.generateImage ?? true,
      remoteSkills: payload.remoteSkills ?? true,
      transcript: payload.transcript,
    }, {
      signal: context.signal,
      onEvent: (event) => context.emit({ type: "braind.mesh.handoff", data: event }),
      onTelemetry: (event) => context.emit({ type: "braind.telemetry", data: event }),
    });
    context.emit({ type: "braind.storm.completed", data: { stormId, artifacts: result.artifacts } });
    return result;
  }, catch: (cause) => new Error(`Braind Storm failed: ${cause instanceof Error ? cause.message : String(cause)}`) }),
});
