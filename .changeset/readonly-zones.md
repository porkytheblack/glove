---
"glove-working-environment": minor
---

`readOnlyPaths` — host-configured directories the agent can read but never edit

The rule the environment already applies to `/std` and `/skills`, made configurable:

```ts
const env = await createWorkingEnvironment({ readOnlyPaths: ["/corpus"] });
await env.mount("./handbook.pdf", "/corpus/handbook.pdf");   // the host door stays open
```

Everything under a zone stays readable, greppable and describable; every mutation — `write_file`, `edit_file`, `rm`, `mv` in **or out**, `mkdir`, `undo` — is refused with an error naming the zone and the fix (copy the file to `/tmp` and work on the copy). Enforcement lives at the core mutation gateway, so it binds every surface at once: the model verbs, scripts going through `env:fs`, and stdlib adapter handles. `env.mount()` deliberately bypasses it — seeding content the agent can only read is what the option is for — while `env.fs`, the guarded host handle, obeys the same rules as the model.

The orientation file announces each zone as READ-ONLY up front, so the model learns the boundary by reading rather than by being refused. Zone directories are created at startup so they are discoverable in `ls` before anything is mounted. Bad configurations (`"/"`, relative paths) fail at creation, to the host.

Pairs naturally with `hostDirectory` for the headline case — hand an agent a real project where some subtrees are reference-only:

```ts
const env = await createWorkingEnvironment({
  filesystem: hostDirectory("./project"),
  readOnlyPaths: ["/src"],          // read and grep the source; write only elsewhere
});
```

Like `stdlib`, the option is not stored in snapshots — the host re-supplies it on restore.
