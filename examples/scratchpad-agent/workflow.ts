/**
 * Subagent workflow — create one, then run it to an answer (no model / no API key).
 *
 * Shows the graph as something the agent *drives via tools*: `workflow_create`
 * defines a multi-subagent workflow from a schema object, and `workflow_run`
 * executes it over the shared scratchpad until the objective resolves — each
 * subagent narrowing in SQL and handing a reference to the next.
 *
 * Here the subagents are stub runnables whose "turn" is a scripted scratchpad
 * operation, so the whole thing runs without a model. In production, `createAgent`
 * returns real Glove subagents and their turns are real tool use over the same
 * surface; the orchestration is identical.
 *
 * Run: `pnpm scratchpad:workflow` (from the repo root).
 */
import { Scratchpad, MemoryBackend, storeAndTruncate } from "glove-scratchpad";
import { workflowTools, type GraphDef } from "glove-scratchpad/graph";
import type { GloveFoldArgs, IGloveRunnable } from "glove-core/glove";
import type { Message } from "glove-core/core";

const rule = () => console.log("─".repeat(72));

function fakeIssues(): unknown {
  return Array.from({ length: 500 }, (_, i) => ({
    id: 1000 + i,
    title: `Issue ${i}`,
    state: i % 3 === 0 ? "open" : "closed",
    priority: i % 5 === 0 ? "P0" : i % 2 === 0 ? "P1" : "P2",
    assignee: `dev-${i % 11}`,
  }));
}

/** Stub subagents: each "turn" is a scripted scratchpad operation. */
type Script = (sp: Scratchpad) => Promise<string>;
function factoryOver(sp: Scratchpad, scripts: Record<string, Script>) {
  return (spec: { name: string }) => {
    const r = {
      setSystemPrompt() {},
      getSystemPrompt() {
        return "";
      },
      fold() {
        return r as unknown as IGloveRunnable;
      },
      async processRequest(): Promise<Message> {
        const fn = scripts[spec.name];
        return { sender: "agent", text: fn ? await fn(sp) : `[${spec.name}] ok` };
      },
    };
    return r as unknown as IGloveRunnable;
  };
}

async function main() {
  const sp = await Scratchpad.create(await MemoryBackend.create());

  // A big tool result, contained on return → reference "issues".
  const search: GloveFoldArgs<Record<string, never>> = {
    name: "issues__search",
    description: "search issues",
    async do() {
      return { status: "success", data: JSON.stringify(fakeIssues()) };
    },
  };
  await storeAndTruncate(search, { scratchpad: sp, name: "issues" }).do(
    {},
    undefined as never,
    undefined as never,
  );

  // What each subagent does on its turn (stand-ins for real tool use).
  const scripts: Record<string, Script> = {
    triage: async (s) => {
      await s.query(`SELECT id, priority, assignee FROM issues WHERE state = 'open'`, { store: "open" });
      return "narrowed to open issues → reference 'open'";
    },
    analyst: async (s) => {
      await s.query(
        `SELECT priority, count(*)::int AS n FROM open GROUP BY priority ORDER BY priority`,
        { store: "by_priority" },
      );
      return "counted open issues by priority → reference 'by_priority'";
    },
    writer: async (s) => {
      const m = await s.materialize({ ref: "by_priority" });
      const parts = m.rows.map((r) => `${r.priority}: ${r.n}`).join(", ");
      return `Open issues by priority — ${parts}.`;
    },
  };

  // The workflow tools the agent would call (here we call them directly).
  const tools = workflowTools({ scratchpad: sp, createAgent: factoryOver(sp, scripts) });
  const create = tools.find((t) => t.name === "workflow_create")!;
  const run = tools.find((t) => t.name === "workflow_run")!;

  const def: GraphDef = {
    name: "triage-flow",
    entry: "triage",
    subagents: [
      { name: "triage", prompt: "Narrow the issues to the relevant set; hand a reference on." },
      { name: "analyst", prompt: "Aggregate the narrowed set in SQL; hand a reference on." },
      { name: "writer", prompt: "Read the aggregate and write the resolved answer." },
    ],
    edges: [
      { from: "triage", to: "analyst", when: "after narrowing" },
      { from: "analyst", to: "writer", when: "after aggregation" },
    ],
  };

  rule();
  console.log("SUBAGENT WORKFLOW — create one, then run it to an answer");
  rule();

  const created = await create.do(def as never, undefined as never, undefined as never);
  const id = (created.data as { id: string }).id;
  console.log(`\nworkflow_create → id "${id}"`);
  for (const s of (created.data as { subagents: { name: string; next: string[] }[] }).subagents) {
    console.log(`  ● ${s.name}  → ${s.next.length ? s.next.join(", ") : "(terminal)"}`);
  }

  const ran = await run.do(
    { id, objective: "How many OPEN issues are there, broken down by priority?" } as never,
    undefined as never,
    undefined as never,
  );
  const data = ran.data as {
    answer: string;
    resolved: boolean;
    refs: string[];
    steps: { subagent: string; output: string }[];
  };

  console.log(`\nworkflow_run → resolved: ${data.resolved}`);
  for (const step of data.steps) console.log(`  ${step.subagent}: ${step.output}`);
  console.log(`\n  references in store: ${data.refs.join(", ")}`);
  rule();
  console.log(`ANSWER: ${data.answer}`);
  rule();

  await sp.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
