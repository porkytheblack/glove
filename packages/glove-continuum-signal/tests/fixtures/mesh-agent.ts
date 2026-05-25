import { Displaymanager, Glove, MemoryStore } from "glove-core";
import {
  InMemoryMeshAdapter,
  MeshNetwork,
  mountMesh,
} from "glove-mesh";
import { agent, z } from "../../src/index.js";
import { EchoModel } from "./echo-model.js";

// One in-memory mesh network per subprocess — fine for the
// mesh-compatibility check, which only cares that mountMesh wires up the
// tools onto the glove. Cross-subprocess routing is out of v1 scope.
const network = new MeshNetwork();

export const meshConcurrent = agent("mesh-concurrent")
  .input(z.object({ phrase: z.string() }))
  .concurrent()
  .timeout(15_000)
  .store((name) => new MemoryStore(`continuum-test-${name}`))
  .factory(async (ctx) => {
    const glove = new Glove({
      store: ctx.store ?? undefined,
      model: new EchoModel(),
      displayManager: new Displaymanager(),
      systemPrompt: "mesh",
      compaction_config: { compaction_instructions: "n/a" },
    }).build(ctx.store ?? undefined);

    await mountMesh(glove, {
      adapter: new InMemoryMeshAdapter(network, ctx.name),
      identity: {
        id: ctx.name,
        name: ctx.name,
        description: "Mesh-compatibility smoke agent.",
      },
    });

    return glove;
  });
