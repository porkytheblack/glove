import { MemoryStore, type GloveFoldArgs } from "glove-core";
import { defineAgent, type AgentAssemblyContext } from "glove-foundry";
import { s2sDrivenModel } from "glove-voice-s2s";
import { briefingInputSchema } from "./briefing-input.js";
import { runBriefingRoom } from "./briefing-room.js";
import { briefingTools } from "./briefing.tools.js";

function callOptions(context: AgentAssemblyContext) {
  const parsed = briefingInputSchema.safeParse(context.request.payload);
  return parsed.success ? parsed.data : undefined;
}

export default defineAgent({
  description: "Mara Vale's live Gemini speech-to-speech briefing line for a Braind Storm workspace.",
  tags: ["braind-storm", "lead", "briefing", "voice", "s2s", "gemini-live"],
  store: ({ conversationId }) => new MemoryStore(`braind:briefing-line:${conversationId}`),
  model: (_definition, context) => {
    const options = callOptions(context);
    return s2sDrivenModel({
      label: "braind-storm-briefing-line",
      provider: "gemini",
      apiKey: process.env.GEMINI_API_KEY,
      model: options?.model ?? process.env.S2S_MODEL ?? "models/gemini-3.1-flash-live-preview",
      voice: options?.voice ?? process.env.BRAIND_VOICE ?? "Kore",
      apiVersion: process.env.S2S_API_VERSION ?? "v1beta",
      realtimeInput: {
        automaticActivityDetection: {
          startOfSpeechSensitivity: "START_SENSITIVITY_HIGH",
          endOfSpeechSensitivity: "END_SENSITIVITY_HIGH",
          prefixPaddingMs: 300,
          silenceDurationMs: 500,
        },
      },
    });
  },
  systemPrompt: (_definition, context) => {
    const options = callOptions(context);
    return [
      "You are Mara Vale, the lead of Braind Storm, speaking on a private live briefing line.",
      "Sound warm, decisive, commercially sharp, and human. Keep turns short enough for a phone conversation. Never use markdown, stage directions, lists, or announce tool calls.",
      "Use get_storm_briefing before stating the status, recommendation, rationale, artifacts, or open questions. Do not invent work that is not in the workspace.",
      "When the caller gives an instruction, correction, decision, constraint, or idea for the workforce, use record_direction before confirming it. Preserve their intent precisely.",
      "When the caller asks you to start, launch, make, execute, or assign campaign work, use launch_campaign_workforce. This is the only tool that starts the workforce; recording direction alone does not start work.",
      "For multiple independent campaigns, choose parallel. If the caller requires a strict order, choose sequential. Otherwise choose auto and express real prerequisites with campaign ids and dependsOn so independent work runs in the same wave.",
      "Before launching, make sure each campaign brief contains enough business, audience, constraint, and outcome detail to act. Ask one concise follow-up only when a critical detail is genuinely missing. After launch, state the number of campaigns, execution plan, and batch run id.",
      "If the workspace is empty, say the team has not completed a storm yet; you may still record direction for the next run.",
      "The caller may interrupt you. Stop cleanly, listen, and answer the new question.",
      `Current storm id: ${options?.stormId ?? "unavailable"}. Foundry run: ${context.runId}.`,
    ].join("\n");
  },
  tools: (_definition, context): ReadonlyArray<GloveFoldArgs<any>> => {
    const options = callOptions(context);
    return options ? briefingTools(options.stormId) : [];
  },
  run: (agent, context) => runBriefingRoom(agent, context),
});
