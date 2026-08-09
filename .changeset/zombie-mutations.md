---
"glove-working-environment": patch
---

A run reported dead can no longer commit its last write.

Terminating a worker stops the script; it does not stop the host. A `core.write` the script asked for is already running on this side and can be queued behind whatever holds the mutation lock, so it landed seconds after `run_script` had told the model the run was killed — silently diverging the tree, and able to clobber the output of the retry the model then makes.

Every host call now carries the run it belongs to. `serve()` refuses one from a run already reported dead before invoking anything, and the mutation queue re-checks liveness *after* granting the lock, which is the window the entry check cannot cover.
