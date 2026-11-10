---
"glove-foundry": minor
---

The hosted mesh can now cross workspaces under the application's rules, and a definition can decide which built-in tools a run gets.

- `defineApplication({ mesh: { peers, authorize, bindThread, commit, refusal } })`:
  - `peers` lists who a sender can reach, in any workspace.
  - `authorize` decides each message: deliver, hold, draft (behind a Foundry approval) or refuse with the application's wording. Deliver, hold and draft look the same to the sender.
  - `bindThread` names a thread after the application's record.
  - `commit` writes each message there before it is delivered. A thread outbox retries the commit and delivers after a failure or restart.
- `runtime.meshHumanMessage`, `runtime.meshTakeOver` and `runtime.releaseMeshMessage` add people to threads, take agents out of them and decide held messages.
- New trace events: `mesh.held`, `mesh.drafted`, `mesh.released`, `mesh.discarded`, `mesh.committed` and `mesh.taken_over`.
- The controller checks that a mesh command comes from the run's own agent and conversation.
- Without an application `mesh`, peers stay in the workspace and nothing is gated.
- `builtins` on `defineAgent` takes `{ block }`, `{ allow }` (or a list) or `{ filter }`, optionally per run, and withholds the built-in tools it excludes. The controller refuses commands that only a withheld tool could send.
- `FOUNDRY_BUILTIN_TOOLS`, `builtinAllowed` and `isFoundryBuiltin` are exported.
- `voiceCall` reports the tools it keeps off a call as `foundry.voice.tools.excluded`.
