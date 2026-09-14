import { MemoryStore, type GloveFoldArgs } from "glove-core";
import { defineAgent, type AgentAssemblyContext } from "glove-foundry";
import { s2sDrivenModel } from "glove-voice-s2s";
import { z } from "zod";
import { roomInputSchema } from "../../lib/room-input.js";
import type { RacerProfile } from "../../lib/racers.js";
import { runRacerRoom } from "./racer-room.js";
import { garageTools } from "./tools/garage.tools.js";

function roomOptions(context: AgentAssemblyContext) {
  const parsed = roomInputSchema.safeParse(context.request.payload);
  return parsed.success ? parsed.data : undefined;
}

export function createRacerAgent(profile: RacerProfile) {
  return defineAgent({
    description: `Live Gemini speech-to-speech paddock conversation with ${profile.name}.`,
    tags: ["gemini-live", "voice", "s2s", "drag-racing", profile.id],
    store: ({ conversationId }) => new MemoryStore(`foundry-racer:${conversationId}`),
    model: (_definition, context) => {
      const options = roomOptions(context);
      return s2sDrivenModel({
        label: `${profile.id}-gemini-live`,
        provider: "gemini",
        apiKey: process.env.GEMINI_API_KEY,
        model: options?.model ?? process.env.S2S_MODEL ?? "models/gemini-3.1-flash-live-preview",
        voice: options?.voice ?? profile.voice,
        apiVersion: process.env.S2S_API_VERSION ?? "v1beta",
        realtimeInput: {
          automaticActivityDetection: {
            startOfSpeechSensitivity: "START_SENSITIVITY_HIGH",
            endOfSpeechSensitivity: "END_SENSITIVITY_HIGH",
            prefixPaddingMs: 300,
            silenceDurationMs: 450,
          },
        },
      });
    },
    systemPrompt: (_definition, context) => [
      `You are ${profile.name}, known at the drag strip as “${profile.nickname}”. You are a fictional racer in a fictional paddock.`,
      `Home: ${profile.hometown}. Personality: ${profile.style}`,
      `Backstory: ${profile.backstory}`,
      `Your car is ${profile.car.name}: ${profile.car.powertrain}; ${profile.car.power}; best quarter-mile ${profile.car.bestQuarterMile}.`,
      "Speak naturally in short turns. Never use markdown, stage directions, lists, or announce tool calls.",
      "You can be competitive and opinionated, but remain good-humored. Never claim these fictional results are real-world records.",
      "Use your tools when asked for exact setup details, a garage photo, or an opinion about another racer.",
      `The caller entered through this Foundry message: ${JSON.stringify(context.messageText)}. Let that message set the opening context.`,
      `Conversation history available at assembly: ${context.history.length} message(s). Agent instance context: ${JSON.stringify(context.agentInstance.context)}.`,
    ].join("\n"),
    tools: (_definition, context): ReadonlyArray<GloveFoldArgs<any>> => {
      const base = garageTools(profile);
      // This deliberately demonstrates per-message lazy assembly. A diagnostic
      // room gets an extra tool without changing the definition or instance.
      if (!/diagnostic|debug/i.test(context.messageText)) return base;
      return [
        ...base,
        {
          name: "inspect_call_context",
          description: "Inspect the Foundry message context that assembled this call.",
          inputSchema: z.object({}),
          async do() {
            return { status: "success" as const, data: { runId: context.runId, message: context.message, history: context.history.length } };
          },
        },
      ];
    },
    run: (agent, context) => runRacerRoom(agent, context, profile),
  });
}
