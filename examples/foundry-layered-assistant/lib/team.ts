/**
 * A person's team, as data. The definitions in agents/ say what an assistant,
 * a coder and a researcher can be; these records are the agents themselves.
 * Each person gets their own workspace, so their agents only see each other.
 *
 * foundry.application.ts seeds the demo person with defineAgentInstance;
 * scripts/onboard.ts creates the same records for anyone else over HTTP.
 */
export function teamFor(person: { readonly id: string; readonly name: string }) {
  const workspaceId = person.id;
  return {
    assistant: { id: person.id, workspaceId, name: "Iris", description: `${person.name}'s assistant`, context: { name: person.name } },
    coder: { id: `${person.id}-coder`, workspaceId, name: "Coder", description: "Writes and runs code in its own workspace. Takes minutes. Give it the whole task." },
    researcher: { id: `${person.id}-researcher`, workspaceId, name: "Researcher", description: "Reads the web and reports back with sources. Takes a minute or two." },
  } as const;
}

/** The person the example starts with. */
export const DEMO_PERSON = { id: "maya", name: "Maya" } as const;
