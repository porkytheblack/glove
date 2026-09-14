import { MemoryStore, createAdapter } from "glove-core";
import { defineAgent } from "glove-foundry";
import { ROLES, type SpecialistId } from "./roles.js";

export function createSpecialistDefinition(id: SpecialistId) {
  const profile = ROLES[id];
  return defineAgent({
    description: `${profile.name}, Braind Storm's ${profile.role}.` ,
    tags: ["braind-storm", "brand-workforce", "mesh-peer", id],
    store: ({ conversationId }) => new MemoryStore(`braind:${id}:${conversationId}`),
    model: () => createAdapter({
      provider: "gemini",
      model: process.env.BRAIND_TEXT_MODEL ?? "gemini-3.5-flash-lite",
      apiKey: process.env.GEMINI_API_KEY,
      stream: false,
      maxTokens: 12_000,
      reasoningEffort: "low",
    }),
    systemPrompt: (_agent, context) => [
      `You are ${profile.name}, the ${profile.role} in Braind Storm.`,
      profile.prompt,
      `This agent instance is ${context.agentId}; its current workspace is ${context.workspaceId}.`,
      "Treat agent definitions as composition data. Mesh, workspace, skills, image, and document surfaces are assembled lazily for the current storm.",
    ].join("\n"),
  });
}
