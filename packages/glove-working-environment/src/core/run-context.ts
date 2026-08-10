/**
 * The run a host-side capability call is being made on behalf of, if any.
 *
 * Two things need this and neither can get it from an argument. The mutation
 * queue has to know whether the run that asked for a write is still alive
 * *after* the lock is granted — a write can sit in the queue for as long as
 * the operation ahead of it takes, and the run can be killed and reported
 * dead in that window. And a `defineTools` capability has to see the run's
 * abort signal, so a cancelled run stops the network call it is sitting on
 * rather than letting it finish into a run nobody is listening to.
 *
 * `AsyncLocalStorage` rather than a parameter because the path from the pool's
 * RPC handler to either of those points runs through arbitrary adapter code.
 * Threading an argument would cover `env:fs` and nothing else.
 *
 * Its own module so the executor and the core can both reach it without
 * importing each other.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface RunContext {
  /** A refusal reason once the run is dead, null while it is alive. */
  abandoned(): string | null;
  /** Aborts when this run is cancelled. Absent when nothing can cancel it. */
  signal?: AbortSignal;
}

export const runContext = new AsyncLocalStorage<RunContext>();
