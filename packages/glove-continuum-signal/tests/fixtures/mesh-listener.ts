import { Displaymanager, Glove } from "glove-core";
import { mountMesh } from "glove-mesh";
import { agent, z } from "../../src/index.js";
import { EchoModel } from "./echo-model.js";
import { FilesystemMeshAdapter } from "./fs-mesh-adapter.js";
import { InboxFileStore } from "./inbox-file-store.js";

/**
 * Concurrent agent that mounts the filesystem mesh adapter and writes its
 * inbox to a file the test parent can inspect. Configured via env vars so
 * the parent can choose paths per test invocation:
 *
 *   CONTINUUM_TEST_MESH_ROOT — shared mesh-network root directory
 *   CONTINUUM_TEST_STORE_PATH — path to the agent's persistent store file
 *
 * The agent itself just sits warm — the test exercises the adapter, not the
 * model. Incoming messages arrive via mountMesh's subscribe handler and land
 * in the inbox-capable file store, where the test reads them.
 */
export const meshListener = agent("mesh-listener")
  .input(z.object({ noop: z.string() }))
  .concurrent()
  .timeout(15_000)
  .store((name) => {
    const path = process.env.CONTINUUM_TEST_STORE_PATH;
    if (!path) throw new Error("CONTINUUM_TEST_STORE_PATH env var not set");
    return new InboxFileStore(`mesh-listener-${name}`, path);
  })
  .factory(async (ctx) => {
    const root = process.env.CONTINUUM_TEST_MESH_ROOT;
    if (!root) throw new Error("CONTINUUM_TEST_MESH_ROOT env var not set");
    const glove = new Glove({
      store: ctx.store ?? undefined,
      model: new EchoModel(),
      displayManager: new Displaymanager(),
      systemPrompt: "mesh-listener",
      compaction_config: { compaction_instructions: "n/a" },
    }).build(ctx.store ?? undefined);

    await mountMesh(glove, {
      adapter: new FilesystemMeshAdapter({ root, agentId: ctx.name }),
      identity: {
        id: ctx.name,
        name: ctx.name,
        description: "Mesh listener for the cross-subprocess smoke test.",
      },
    });

    return glove;
  });
