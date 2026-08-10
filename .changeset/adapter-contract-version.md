---
"glove-working-environment": minor
---

Restore-time compatibility the model can actually see

Two gaps closed, both about a tree that comes back healthy-looking and breaks later.

**`StdlibAdapter.version`** — an optional binding-contract version. A module the host never registered is caught at startup; a binding renamed or removed fails at the next run with its own name in the error. A binding whose *signature* changed under the same name was invisible at every layer: the import resolves, the call is made with arguments that no longer mean what they did, and the failure lands inside the adapter with a message about neither.

```ts
export function documents(): StdlibAdapter {
  return { name: "documents", version: "2.0.0", /* … */ };
}
```

Every startup records the registered versions in `/.env/adapters.json` — in the tree rather than in snapshot metadata, so there is no `EnvSnapshot` format bump and it works for a host-supplied persistent filesystem too. The next startup compares and reports a difference on `env.warnings` and in the model's orientation file, naming the `.d.ts` to re-read. The version also rides beside the module in `/std/README.md` and in orientation's module list.

Skew is a **warning, never a refusal**, including under `strictAdapters`: restoring across a version bump is the normal case, and refusing to start would make every dependency upgrade a data-loss event for anyone holding a snapshot. An adapter that declares no version opts out entirely and no file is written.

**Restore warnings now reach the model.** `env.warnings` is host-only, so a restored tree whose scripts import an unregistered module oriented cleanly and failed mid-task whenever the host logged the warning and carried on. `/.env/orientation.md` opens with the mismatches — version skew and every `env:` module the stored scripts import that this host did not register, with the scripts named. It is recomputed on every read rather than reusing the startup scan, because `checkpoint restore` writes a stored tree in below validation: a session can acquire scripts importing an unregistered module without ever restarting.
