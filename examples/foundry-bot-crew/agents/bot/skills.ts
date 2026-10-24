import { Effect } from "effect";
import type { ContentSkill } from "glove-core";
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

export async function saveSkill(data: FoundryDataAdapter, workspaceId: string, skill: SavedSkill): Promise<void> {
  await Effect.runPromise(data.putWorkspaceEntry({
    workspaceId,
    key: `${PREFIX}${skill.name}`,
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
