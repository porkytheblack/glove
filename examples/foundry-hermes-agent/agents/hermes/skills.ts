import type { DefineSkillArgs } from "glove-core";

export const planningSkill: DefineSkillArgs = {
  name: "plan",
  description: "Turn an ambiguous objective into an adaptive execution plan",
  exposeToAgent: true,
  async handler({ args, parsedText }) {
    return [
      "Build a short plan from the user's outcome, not a hard-coded workflow.",
      "Use tools and subagents only where they materially reduce uncertainty.",
      `Objective: ${args ?? parsedText}`,
    ].join("\n");
  },
};

export const researchSkill: DefineSkillArgs = {
  name: "research",
  description: "Collect evidence, preserve sources, and separate facts from inference",
  exposeToAgent: true,
  async handler({ args, parsedText }) {
    return [
      "Research mode: inspect mounted knowledge, delegate independent questions, and save useful artefacts in /out.",
      "Distinguish cited evidence, observation, and inference.",
      `Focus: ${args ?? parsedText}`,
    ].join("\n");
  },
};
