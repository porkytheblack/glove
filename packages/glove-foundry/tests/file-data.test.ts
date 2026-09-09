import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Effect } from "effect";
import { FileFoundryDataAdapter } from "../src/file-data.js";
import { createAgentInstance, createConversation } from "../src/primitives.js";

test("FileFoundryDataAdapter survives reconstruction and serializes competing writers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "foundry-file-data-"));
  const file = join(directory, "foundry.json");
  const seed = createAgentInstance("assistant", {
    id: "assistant-primary",
    workspaceId: "workspace-primary",
    context: { name: "Primary" },
  });
  const conversation = createConversation(seed, { id: "conversation-primary" });
  try {
    const first = new FileFoundryDataAdapter({
      file,
      identifier: "file-data-test",
      agents: [seed],
      conversations: [conversation],
      environment: [{
        key: "region",
        value: "test",
        scope: "workspace",
        workspaceId: seed.workspaceId,
      }],
    });

    assert.equal((await Effect.runPromise(first.getAgent(seed.id)))?.definitionId, "assistant");
    await Promise.all([
      Effect.runPromise(first.putWorkspaceEntry({
        workspaceId: seed.workspaceId,
        key: "alpha",
        value: { ready: true },
        updatedAt: new Date().toISOString(),
      })),
      Effect.runPromise(first.putWorkspaceEntry({
        workspaceId: seed.workspaceId,
        key: "beta",
        value: [1, 2, 3],
        updatedAt: new Date().toISOString(),
      })),
    ]);
    assert.equal(await Effect.runPromise(first.claimInboundDelivery("route:event")), true);
    await Effect.runPromise(first.completeInboundDelivery("route:event", ["run-1"]));
    await Effect.runPromise(first.putWorkingEnvironmentSnapshot({
      scope: "conversation",
      definitionId: "assistant",
      agentId: seed.id,
      conversationId: conversation.id,
      workspaceId: seed.workspaceId,
    }, {
      version: 1,
      dirs: ["/", "/out"],
      files: [{ path: "/out/result.txt", data: "cmVhZHk=", mtime: 1 }],
    }));

    const second = new FileFoundryDataAdapter({ file, agents: [seed] });
    assert.deepEqual(
      (await Effect.runPromise(second.listWorkspaceEntries(seed.workspaceId))).map((item) => item.key).sort(),
      ["alpha", "beta"],
    );
    assert.deepEqual(
      (await Effect.runPromise(second.getInboundDelivery("route:event")))?.runIds,
      ["run-1"],
    );
    assert.equal(
      (await Effect.runPromise(second.getWorkingEnvironmentSnapshot({
        scope: "conversation",
        definitionId: "assistant",
        agentId: seed.id,
        conversationId: conversation.id,
        workspaceId: seed.workspaceId,
      })))?.files[0]?.path,
      "/out/result.txt",
    );
    assert.equal((await Effect.runPromise(second.listEnvironment({ workspaceId: seed.workspaceId })))[0]?.value, "test");

    const third = new FileFoundryDataAdapter({ file });
    const [provisionedA, provisionedB] = await Promise.all([
      Effect.runPromise(second.provisionAgent({
        definitionId: "assistant",
        provisioningKey: "inbound:operator",
        workspaceId: seed.workspaceId,
      })),
      Effect.runPromise(third.provisionAgent({
        definitionId: "assistant",
        provisioningKey: "inbound:operator",
        workspaceId: seed.workspaceId,
      })),
    ]);
    assert.equal(provisionedA.id, provisionedB.id);
    assert.equal((await Effect.runPromise(third.listAgents("assistant"))).length, 2);

    const persisted = JSON.parse(await readFile(file, "utf8")) as { version: number };
    assert.equal(persisted.version, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
