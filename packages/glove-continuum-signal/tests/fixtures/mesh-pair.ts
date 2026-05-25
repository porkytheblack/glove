import { join } from "node:path";
import { Displaymanager, Glove } from "glove-core";
import { mountMesh } from "glove-mesh";
import { agent, z } from "../../src/index.js";
import { EchoModel } from "./echo-model.js";
import { FilesystemMeshAdapter } from "./fs-mesh-adapter.js";
import { InboxFileStore } from "./inbox-file-store.js";
import { MeshSendingModel } from "./mesh-sending-model.js";

/**
 * Two concurrent agents sharing a filesystem mesh network. The "sender" uses
 * `MeshSendingModel` to emit one `glove_mesh_send_message` tool call per
 * notify; the "receiver" uses `EchoModel` and just sits warm waiting for
 * mesh-delivered inbox items.
 *
 * Each agent computes its own store path under `<MESH_ROOT>/stores/<name>.json`
 * so the test parent can inspect both inboxes without per-agent env vars.
 *
 * Both agents read `CONTINUUM_TEST_MESH_ROOT` from env to find the shared
 * filesystem network.
 */
function storePath(meshRoot: string, name: string): string {
  return join(meshRoot, "stores", `${name}.json`);
}

function meshRootOrThrow(): string {
  const root = process.env.CONTINUUM_TEST_MESH_ROOT;
  if (!root) throw new Error("CONTINUUM_TEST_MESH_ROOT env var not set");
  return root;
}

export const meshSender = agent("mesh-sender")
  .input(z.object({ to: z.string(), content: z.string() }))
  .concurrent()
  .timeout(15_000)
  .store((name) => new InboxFileStore(`sender-${name}`, storePath(meshRootOrThrow(), name)))
  .factory(async (ctx) => {
    const root = meshRootOrThrow();
    const glove = new Glove({
      store: ctx.store ?? undefined,
      model: new MeshSendingModel(),
      displayManager: new Displaymanager(),
      systemPrompt: "mesh-sender",
      compaction_config: { compaction_instructions: "n/a" },
    }).build(ctx.store ?? undefined);

    await mountMesh(glove, {
      adapter: new FilesystemMeshAdapter({ root, agentId: ctx.name }),
      identity: {
        id: ctx.name,
        name: ctx.name,
        description: "Sends one mesh message per notify.",
      },
    });

    return glove;
  });

export const meshReceiver = agent("mesh-receiver")
  .input(z.object({ noop: z.string() }))
  .concurrent()
  .timeout(15_000)
  .store((name) => new InboxFileStore(`receiver-${name}`, storePath(meshRootOrThrow(), name)))
  .factory(async (ctx) => {
    const root = meshRootOrThrow();
    const glove = new Glove({
      store: ctx.store ?? undefined,
      model: new EchoModel(),
      displayManager: new Displaymanager(),
      systemPrompt: "mesh-receiver",
      compaction_config: { compaction_instructions: "n/a" },
    }).build(ctx.store ?? undefined);

    await mountMesh(glove, {
      adapter: new FilesystemMeshAdapter({ root, agentId: ctx.name }),
      identity: {
        id: ctx.name,
        name: ctx.name,
        description: "Sits warm and writes inbound mesh messages to its inbox.",
      },
    });

    return glove;
  });
