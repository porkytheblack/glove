import { Displaymanager, Glove } from "glove-core";
import { agent, z } from "../../src/index.js";
import { EchoModel } from "./echo-model.js";
import { FileStore } from "./file-store.js";

// File path is supplied via env so the test parent can choose where to
// persist (and inspect the file after the runs). Read at call time, not at
// module load, so tests that import the fixture before setting the env still
// pick up the right value when the store factory actually runs.
export const persistentTriggered = agent("persistent-triggered")
  .input(z.object({ phrase: z.string() }))
  .triggered()
  .timeout(15_000)
  .store((name) => {
    const storePath = process.env.CONTINUUM_TEST_STORE_PATH;
    if (!storePath) {
      throw new Error("CONTINUUM_TEST_STORE_PATH env var not set");
    }
    return new FileStore(`continuum-persist-${name}`, storePath);
  })
  .factory(async (ctx) => {
    return new Glove({
      store: ctx.store ?? undefined,
      model: new EchoModel(),
      displayManager: new Displaymanager(),
      systemPrompt: "persistent",
      compaction_config: { compaction_instructions: "n/a" },
    }).build(ctx.store ?? undefined);
  });
