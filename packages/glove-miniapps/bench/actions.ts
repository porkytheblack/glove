/**
 * What an action costs as an app grows, per backend. Run:
 *   node --no-warnings=ExperimentalWarning --import tsx bench/actions.ts
 */
import { createAppHost, memoryBackend, type AppDefinition, type Backend } from "../src/index";
import { sqliteBackend } from "../src/sqlite";

const app: AppDefinition = {
  name: "notes",
  description: "Notes",
  schema: { notes: { columns: { id: { type: "integer", primaryKey: true }, body: { type: "text" }, done: { type: "boolean", default: false } } } },
  methods: {
    add: { kind: "action", description: "Add", params: { body: { type: "string" } }, sql: "INSERT INTO notes (body) VALUES (:body) RETURNING id", returns: "one" },
    add_js: { kind: "action", description: "Add (js)", params: { body: { type: "string" } }, js: "db.one({ sql: 'INSERT INTO notes (body) VALUES (:b) RETURNING id', params: { b: args.body } })" },
    open: { kind: "query", description: "Open", sql: "SELECT count(*) AS n FROM notes WHERE done = false", returns: "one" },
  },
};

async function measure(name: string, backend: Backend) {
  const host = await createAppHost({ backend });
  await host.deploy(app, { as: "bench" });
  const row: string[] = [name];
  let rows = 0;
  for (const target of [100, 1_000, 5_000]) {
    while (rows < target) {
      await host.call("notes", "add", { body: `note ${rows}` }, { as: "bench" });
      rows++;
    }
    const time = async (method: string, args: Record<string, unknown>, n = 20) => {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) await host.call("notes", method, args, { as: "bench" });
      return (performance.now() - t0) / n;
    };
    const sql = await time("add", { body: "x" });
    const js = await time("add_js", { body: "x" });
    const q = await time("open", {});
    rows += 40;
    row.push(`${target}: sql action ${sql.toFixed(2)} ms, js action ${js.toFixed(2)} ms, query ${q.toFixed(2)} ms`);
  }
  await host.close();
  console.log(row.join("\n  "));
}

await measure("memory (glove-sql)", memoryBackend());
await measure("sqlite :memory:", sqliteBackend());
