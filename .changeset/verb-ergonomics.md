---
"glove-working-environment": minor
---

Ergonomics batch, plus an advisory check on script arguments.

- **`write_file` takes `encoding: "base64"`**, so binary can be written without a script. Malformed base64 is refused rather than half-decoded — Node decodes what it can and drops the rest, which writes a corrupt file that only fails inside whatever reads it later.
- **A `diff` verb**: current content against the version `undo` would restore, or against a named checkpoint. Those two verbs were previously the only way to find out what they would change, and they found out by doing it. Handles the created and deleted cases as well as the edited one.
- **`env:std.sleep(ms)`**. The sandbox has no timers, so the only way to wait was `while (Date.now() < until) await null` — which burns CPU and starves the macrotask queue. Waiting matters now that `defineTools` points scripts at real services. Capped at 60s per call; the run's own deadline still applies.
- **Orientation lists the limits** — file size, tree size, run budget with a pointer to `timeout_ms`, undo depth. Every one of those was previously discovered by hitting it.
- **A wildcard path in `rm`/`mv`/`cp`** returns the `env:fs.glob` recipe using the pattern that was asked for, instead of a literal "no such file or directory: /tmp/*.png" that reads as a filesystem problem.
- **Script arguments are checked against their own JSDoc** before a run, advisory and non-blocking: a missing required key or an unrecognised one is reported with the declared shape. A stale JSDoc block must never make a working script unrunnable, so the run happens either way.
