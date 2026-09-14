import { FactStore } from "glove-facts";
import { createSqliteMemoryAdapters } from "../../src/sqlite/index";
import { MemorySchema } from "../../src/core/schema";
const [mode, file, id] = process.argv.slice(2);
const adapter = createSqliteMemoryAdapters({ file, namespace: "owner", schema: new MemorySchema(), busyTimeoutMs: 10000 }).facts;
const scope = { subject: "customer", context: "intake" };
if (mode === "append") {
  const facts = new FactStore(adapter, { scope });
  for (let i = 0; i < 5; i++) await facts.record({ text: `${id}:${i}`, source: { kind: "message", id: `${id}:${i}` } }, { operationId: `${id}:${i}` });
} else if (mode === "hold") {
  await adapter.withScope(scope, async tx => {
    const state = await tx.read();
    await tx.save({ ...state, version: state.version + 1 });
    process.send?.("saved-and-locked");
    await new Promise(() => { setInterval(() => undefined, 1000); });
  });
} else throw new Error("Unknown fixture operation");
