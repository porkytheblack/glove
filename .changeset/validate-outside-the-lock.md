---
"glove-working-environment": patch
---

Script validation no longer holds the mutation queue.

Validating a script means executing its top level in a worker, with a budget of `runTimeoutMs` — up to 30 seconds by default. Done inside the lock, every other mutation waited behind it, including the `env:fs` writes of scripts running right now whose own deadlines kept ticking: a 1.2s top level in a script the model was saving made an unrelated run's `writeFile` wait 1.5s, and a long enough one kills that run with a timeout that reads as its own fault.

Validation now runs before the lock is taken and only the commit is serialized. `edit` — whose bytes are a function of the file it read — validates optimistically and re-checks that the base is unchanged before committing, retrying if something else rewrote the file underneath it.
