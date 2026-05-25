import { Displaymanager, Glove, MemoryStore } from "glove-core";
import { agent, z } from "../../src/index.js";
import { EchoModel } from "./echo-model.js";

export const echoConcurrent = agent("echo-concurrent")
  .input(z.object({ phrase: z.string() }))
  .concurrent()
  .timeout(15_000)
  .store((name) => new MemoryStore(`continuum-test-${name}`))
  .factory(async (ctx) => {
    return new Glove({
      store: ctx.store ?? undefined,
      model: new EchoModel(),
      displayManager: new Displaymanager(),
      systemPrompt: "concurrent",
      compaction_config: { compaction_instructions: "n/a" },
    }).build(ctx.store ?? undefined);
  });
