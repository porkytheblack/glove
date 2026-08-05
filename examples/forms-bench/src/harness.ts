/**
 * One cell of the matrix: a fresh in-memory store, a fresh instance, and the
 * runner wired the way a host would wire it.
 *
 * Every run gets its own `subject`, so nothing leaks between cells and the
 * grader can find the instance the conversation actually ended on — including
 * one the model created by calling `start` again.
 */
import { MemorySchema } from "glove-memory/core";
import { InMemoryFormAdapter } from "glove-memory/in-memory";
import { compileForm, FormRegistry, FormRunner } from "glove-memory/forms";
import type { CompiledForm } from "glove-memory/forms";
import { travelClaim } from "./form";

export interface Cell {
  adapter: InMemoryFormAdapter;
  runner: FormRunner;
  compiled: CompiledForm<any>;
  subject: string;
  instanceId: string;
}

let seq = 0;

export async function makeCell(): Promise<Cell> {
  const schema = new MemorySchema();
  const adapter = new InMemoryFormAdapter({ schema });
  const registry = new FormRegistry().register(travelClaim.id, {
    name: travelClaim.name,
    description: travelClaim.description,
    load: () => travelClaim,
  });
  const subject = `bench-${++seq}-${Math.random().toString(36).slice(2, 8)}`;
  const runner = new FormRunner(adapter, {
    registry,
    subject,
    actor: "bench",
    source: "forms-bench",
  });

  // The conversation opens with the form already in progress — the common host
  // case, and it keeps `start` out of the critical path so a model that never
  // calls it isn't penalised for something the host would normally do.
  const started = await runner.start(travelClaim.id);

  return {
    adapter,
    runner,
    compiled: compileForm(travelClaim),
    subject,
    instanceId: started.view.instanceId,
  };
}
