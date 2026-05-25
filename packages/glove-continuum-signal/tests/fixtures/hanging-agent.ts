import { Displaymanager, Glove, MemoryStore } from "glove-core";
import { agent, z } from "../../src/index.js";
import { EchoModel } from "./echo-model.js";

/**
 * Triggered agent whose factory hangs forever — used to verify that the
 * parent's timeout machinery still produces a paired close-bracket event.
 */
export const hangingAgent = agent("hanging-agent")
  .input(z.object({ noop: z.string() }))
  .triggered()
  .timeout(500) // very short — parent will SIGTERM the child
  .store((name) => new MemoryStore(`continuum-test-${name}`))
  .factory(async () => {
    // Block forever; the parent's checkTimeouts() should kill us.
    await new Promise(() => {});
    return new Glove({
      model: new EchoModel(),
      displayManager: new Displaymanager(),
      systemPrompt: "hang",
      compaction_config: { compaction_instructions: "n/a" },
    }).build();
  });
