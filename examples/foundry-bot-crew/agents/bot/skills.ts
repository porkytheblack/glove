import { Effect } from "effect";
import type { ContentSkill, DefineSkillArgs } from "glove-core";
import type { FoundryDataAdapter } from "glove-foundry";

/**
 * A person's skills: workflows any of their bots can run. They live in the
 * person's workspace, so every bot on the team reads the same library.
 */
export interface SavedSkill {
  readonly name: string;
  readonly description: string;
  readonly steps: string;
  readonly by: string;
}

const PREFIX = "skill:";

/** The workspace entry a skill is kept under. */
export const skillKey = (name: string): string => `${PREFIX}${name}`;

export async function saveSkill(data: FoundryDataAdapter, workspaceId: string, skill: SavedSkill): Promise<void> {
  await Effect.runPromise(data.putWorkspaceEntry({
    workspaceId,
    key: skillKey(skill.name),
    value: skill,
    updatedAt: new Date().toISOString(),
  }));
}

export async function loadSkills(data: FoundryDataAdapter, workspaceId: string): Promise<ContentSkill[]> {
  return (await Effect.runPromise(data.listWorkspaceEntries(workspaceId)))
    .filter((entry) => entry.key.startsWith(PREFIX))
    .map((entry) => entry.value as SavedSkill)
    .map((skill) => ({ name: skill.name, description: skill.description, content: `# ${skill.name}\n\n${skill.steps}` }));
}

/**
 * The library as `/name` skills, the way glove-core's useReadSkill wires
 * them: "/monday-signups" in a message puts that skill's steps in front of
 * whichever bot gets the message. Bots find and read skills themselves with
 * glove_read_skill.
 */
export async function slashSkills(data: FoundryDataAdapter, workspaceId: string): Promise<DefineSkillArgs[]> {
  return (await loadSkills(data, workspaceId)).map((skill) => ({
    name: skill.name,
    description: skill.description,
    exposeToAgent: false,
    handler: async () => skill.content,
  }));
}
