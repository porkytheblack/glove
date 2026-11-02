/**
 * A person's assistant, as data. The definitions in agents/ say what an
 * assistant, a coder and a researcher can be; this record is the agent itself.
 * Each person gets their own workspace. The coder and the researcher are its
 * delegates: Foundry creates one worker instance per assistant on the first
 * task.
 *
 * foundry.application.ts seeds the demo person with defineAgentInstance;
 * scripts/onboard.ts creates the same record for anyone else over HTTP.
 */
export function assistantFor(person: { readonly id: string; readonly name: string }) {
  return { id: person.id, workspaceId: person.id, name: "Iris", description: `${person.name}'s assistant`, context: { name: person.name } } as const;
}

/** The person the example starts with. */
export const DEMO_PERSON = { id: "maya", name: "Maya" } as const;
