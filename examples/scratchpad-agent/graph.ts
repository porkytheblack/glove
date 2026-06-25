/**
 * Subagent graphs — schema object in, wired topology out (no model / no API key).
 *
 * Shows the graph as *data*: a plain `GraphDef` listing subagents, their prompts,
 * and the tool slice each one sees, plus the edges between them. The adapter
 * (`buildScratchpadGraph`) constructs the wired topology — folding each node's
 * tools (interface disclosure), mounting the scratchpad surface, and stamping
 * provenance. Here `createAgent` returns lightweight stub runnables so we can
 * print exactly what got wired without spinning up a model.
 *
 * Run: `pnpm scratchpad:graph` (from the repo root).
 */
import { Scratchpad, MemoryBackend } from "glove-scratchpad";
import { buildScratchpadGraph, type GraphDef } from "glove-scratchpad/graph";
import type { GloveFoldArgs, IGloveRunnable } from "glove-core/glove";

const rule = () => console.log("─".repeat(72));

/** A no-op tool, standing in for a real data source. */
const tool = (name: string): GloveFoldArgs<Record<string, never>> => ({
  name,
  description: name,
  async do() {
    return { status: "success", data: null };
  },
});

/** A stub runnable that records what the adapter wires onto it. */
function stubRunnable() {
  const tools: string[] = [];
  let prompt = "";
  const r = {
    get tools() {
      return tools;
    },
    get prompt() {
      return prompt;
    },
    setSystemPrompt(p: string) {
      prompt = p;
    },
    getSystemPrompt() {
      return prompt;
    },
    fold(t: GloveFoldArgs<unknown>) {
      tools.push(t.name);
      return r as unknown as IGloveRunnable;
    },
  };
  return r;
}

// ── The graph, as a plain schema-validated object ────────────────────────────
const def: GraphDef = {
  name: "issue-triage",
  entry: "planner",
  subagents: [
    {
      name: "planner",
      prompt: "Plan the triage. Call issues__search, then narrow in SQL and hand a reference downstream.",
      tools: ["issues__search"], // its capability slice
    },
    {
      name: "analyst",
      prompt: "Given a reference, aggregate in SQL (counts by priority/assignee). Pass a narrowed reference on.",
      defaultLimit: 100,
    },
    {
      name: "writer",
      prompt: "Read the final narrowed reference and write a short human summary.",
      defaultLimit: 20,
    },
  ],
  edges: [
    { from: "planner", to: "analyst", when: "after the search is contained" },
    { from: "analyst", to: "writer", when: "after aggregation" },
  ],
};

async function main() {
  const sp = await Scratchpad.create(await MemoryBackend.create());
  const stubs = new Map<string, ReturnType<typeof stubRunnable>>();

  const graph = await buildScratchpadGraph(def, {
    scratchpad: sp,
    tools: { issues__search: tool("issues__search") as GloveFoldArgs<unknown> },
    createAgent: (spec) => {
      const s = stubRunnable();
      stubs.set(spec.name, s);
      return s as unknown as IGloveRunnable;
    },
  });

  rule();
  console.log(`SUBAGENT GRAPH "${graph.def.name}" — constructed from a schema object`);
  rule();

  for (const node of graph.nodes.values()) {
    const s = stubs.get(node.spec.name)!;
    const slice = s.tools.filter((t) => !t.startsWith("scratchpad_"));
    const mounted = s.tools.some((t) => t.startsWith("scratchpad_"));
    console.log(`\n● ${node.spec.name}${node.spec.name === graph.def.entry ? "  (entry)" : ""}`);
    console.log(`  prompt:     ${node.spec.prompt.slice(0, 60)}…`);
    console.log(`  tool slice: ${slice.length ? slice.join(", ") : "(none)"}`);
    console.log(`  scratchpad: ${mounted ? "mounted (describe/query/materialize/list)" : "—"}, actor="${node.spec.name}"`);
    const succ = graph.next(node.spec.name).map((n) => n.spec.name);
    console.log(`  → next:     ${succ.length ? succ.join(", ") : "(terminal)"}`);
  }

  rule();
  console.log("Edges:");
  for (const e of graph.edges) console.log(`  ${e.from} → ${e.to}   (${e.when ?? ""})`);
  rule();
  console.log("The object is the contract; the adapter did the wiring.");
  rule();

  await sp.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
