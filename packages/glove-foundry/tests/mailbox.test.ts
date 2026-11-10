import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { drainMailbox, mailboxName, writeMailboxDelivery } from "../src/delegation.js";

test("mailbox names are 64 bytes whatever the conversation id, and keep a person's mesh fields", async () => {
  const directory = await mkdtemp(join(tmpdir(), "glove-foundry-mailbox-"));
  try {
    const id = `transmission:agent:agent_${"f".repeat(64)}:${"c".repeat(400)}`;
    assert.equal(mailboxName(id).length, 64);
    assert.notEqual(mailboxName(id), mailboxName(`${id}x`));
    await writeMailboxDelivery(directory, id, {
      kind: "mesh",
      side: "starter",
      peer: "bo-coder",
      deliveryId: "msg_1",
      message: {
        kind: "message", id: "msg_1", threadId: "thread", from: { agentId: "lena", name: "Lena", kind: "human" },
        to: "ada", content: "Friday instead", createdAt: new Date().toISOString(),
      },
    });
    assert.deepEqual(await readdir(directory), [mailboxName(id)]);
    const [delivery] = await drainMailbox(directory, id);
    assert.equal(delivery?.kind, "mesh");
    const mesh = delivery as Extract<typeof delivery, { kind: "mesh" }>;
    assert.equal(mesh.message.from.kind, "human");
    assert.equal(mesh.peer, "bo-coder");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
