/**
 * A person's team, as data. The definitions in agents/ say what an assistant,
 * a coder and a researcher can be; these instances are the agents themselves.
 * Each person gets their own workspace, so their agents only see each other.
 */
export function teamFor(person: { readonly id: string; readonly name: string }) {
  const workspaceId = person.id;
  return {
    assistant: {
      definition: "assistant",
      options: { id: person.id, workspaceId, name: "Iris", description: `${person.name}'s assistant`, context: { name: person.name } },
    },
    workers: [
      {
        definition: "coder",
        options: { id: `${person.id}-coder`, workspaceId, name: "Coder", description: "Writes and runs code in its own workspace. Takes minutes. Give it the whole task." },
      },
      {
        definition: "researcher",
        options: { id: `${person.id}-researcher`, workspaceId, name: "Researcher", description: "Reads the web and reports back with sources. Takes a minute or two." },
      },
    ],
  } as const;
}
