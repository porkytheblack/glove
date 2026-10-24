---
"glove-foundry": minor
---

Foundry hosts Glove Mesh, instances carry a name and a description, and voice calls.

- `defineAgent({ mesh: true })` gives an agent the Glove Mesh tools: `glove_mesh_list_agents`, `glove_mesh_send_message`, `glove_mesh_broadcast` and `glove_mesh_acknowledge`. Agents are addressed by instance id. Its peers are the other instances in its workspace, so who is on a team is data, not code.
- `mesh: { peers, waitMs, mount }`. `peers(self, peer)` narrows who an agent may see and message, from instance data. An agent can always answer whoever messaged it. `waitMs` (90 s by default) is how long a blocking send waits inside the run. `mount(ctx)` decides per run whether the tools are there at all, so a read-only run can have none.
- A new message starts a thread: a conversation on the recipient. Its final reply goes back to the conversation that sent it on its own, and a run that fails or is cancelled sends a failure. Messages either way go straight into a run that listens with `ctx.onMeshMessage`. Otherwise they wait until the conversation is free and start one run, with source kind `"mesh"`, as `<mesh-message>` messages.
- A blocking send that runs out of time suspends the run with `suspension.kind: "mesh"`. Open threads appear in the sender's runtime context. `runtime.listThreads()` lists them all. Messages still owed are recorded on the thread and handed over again after a restart.
- `AgentInstance` has `name` and `description`. `createAgent`, `configureAgent` and the HTTP API set them, the inspector shows them, and the mesh lists agents by them. A tool can write them, so an agent can rename itself.
- Schedules no longer skip because another instance of the same definition is busy. Overlap was checked per definition, so with many instances of one definition a busy agent made the others miss their schedules.
- New `glove-foundry/voice` subpath. `voiceCall({ room, greeting })` runs an agent as a live call over `RealtimeAgent`: it saves the transcript, speaks mesh messages at the next pause (`announceMeshMessage`), and keeps Foundry's bookkeeping tools and approval-gated tools off the call. `webSocketRoom({ port, token })` is a built-in room serving PCM16 over one WebSocket.
