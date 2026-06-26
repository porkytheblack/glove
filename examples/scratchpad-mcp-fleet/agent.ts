/**
 * The capstone: a 10-provider "code execution environment for MCP".
 *
 * NONE of the 10 providers are loaded up front. The agent DISCOVERS the ones a
 * churn-risk board needs (via glove-mcp's discovermcp subagent), each activated
 * tool's big result is CONTAINED in the scratchpad (containingWrap), and the
 * agent JOINs across providers in SQL and materializes only the final board.
 * Everything is OBSERVED (scratchpad events + containment telemetry) and
 * PERSISTED as it goes (auto-persist) — so the run is resumable.
 *
 *   interface disclosure (discovery)  +  result containment (scratchpad)
 *   +  storable/resumable (persist)    +  observability (events)
 *
 * Run (from the repo root): `pnpm scratchpad:fleet`  (needs OPENROUTER_API_KEY)
 */
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../../.env") });
dotenv.config({ path: join(__dirname, ".env") });

import { Glove, Displaymanager, MemoryStore } from "glove-core";
import { createAdapter } from "glove-core/models/providers";
import type { SubscriberAdapter } from "glove-core";
import { mountMcp } from "glove-mcp";
import {
  Scratchpad,
  MemoryBackend,
  mountScratchpad,
  createScratchpadStats,
  MemoryScratchpadStore,
  autoPersistScratchpad,
  restoreScratchpad,
} from "glove-scratchpad";
import { containingWrap, createContainmentReporter } from "glove-scratchpad/mcp";
import { startFleet } from "./mcp-fleet";
import { InMemoryMcpAdapter } from "./adapter";

const rule = () => console.log("─".repeat(76));
const truncate = (s: string, n = 150) => (s.length > n ? `${s.slice(0, n)}…` : s);

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL ?? "moonshotai/kimi-k2.5";
  if (!apiKey) {
    console.error("Set OPENROUTER_API_KEY in the repo-root .env. (No-key mechanism check: `pnpm scratchpad:fleet-smoke`.)");
    process.exit(1);
  }

  console.log(`\n10-provider scratchpad fleet — model: ${model} (via OpenRouter)\n`);
  const fleet = await startFleet();
  console.log(`  catalogue: ${fleet.catalogue.map((c) => c.id).join(", ")} (none loaded up front)`);

  const sp = await Scratchpad.create(await MemoryBackend.create());
  const reporter = createContainmentReporter();
  const stats = createScratchpadStats();
  sp.subscribe(stats.subscriber);

  // Resumability: snapshot to a store on every mutation (debounced).
  const snapStore = new MemoryScratchpadStore();
  const sessionId = "fleet-demo";
  const stopPersist = autoPersistScratchpad(sp, { store: snapStore, key: sessionId });

  const agent = new Glove({
    store: new MemoryStore(sessionId),
    model: createAdapter({ provider: "openrouter", model, stream: true }),
    displayManager: new Displaymanager(),
    serverMode: true,
    systemPrompt: SYSTEM_PROMPT,
    compaction_config: { compaction_instructions: "Summarize progress; keep the scratchpad references and what each holds." },
  }).build();
  agent.addSubscriber(traceSubscriber());

  // The whole catalogue is discoverable; activated tools are contained.
  await mountMcp(agent, {
    adapter: new InMemoryMcpAdapter(sessionId, []), // nothing active — the agent must discover
    entries: fleet.catalogue,
    wrapTool: containingWrap(sp, { actor: undefined, onContain: reporter.onContain }),
  });
  mountScratchpad(agent, { scratchpad: sp });

  rule();
  console.log("OBJECTIVE\n");
  console.log(OBJECTIVE.trim());
  rule();
  console.log("AGENT TRACE  (discovery + the SQL it writes)\n");

  const started = Date.now();
  await agent.processRequest(OBJECTIVE);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  await stopPersist(); // flush the final snapshot

  rule();
  console.log("SCRATCHPAD RECORDS\n");
  for (const r of await sp.list()) console.log(`  ${r.ref}  —  ${r.rowCount} rows  [${r.kind}]  (from ${r.provenance.actor ?? r.provenance.source})`);

  rule();
  console.log("RESUMABILITY — restore the persisted snapshot into a fresh scratchpad\n");
  const restored = await restoreScratchpad({ store: snapStore, key: sessionId });
  if (restored) {
    const refs = (await restored.list()).map((r) => r.ref);
    console.log(`  restored ${refs.length} references from the snapshot: ${refs.join(", ")}`);
    await restored.close();
  } else {
    console.log("  (nothing was persisted — the agent created no records)");
  }

  rule();
  console.log("OBSERVABILITY\n");
  console.log(`  containment : ${reporter.format()}`);
  console.log(`  scratchpad  : ${stats.format()}`);
  console.log(`  wall clock  : ${elapsed}s`);
  rule();

  await fleet.close();
  await sp.close();
}

function traceSubscriber(): SubscriberAdapter {
  return {
    async record(event_type, data) {
      if (event_type === "tool_use") {
        const { name, input } = data as { name: string; input: unknown };
        const sql = (input as { sql?: string })?.sql;
        const prompt = (input as { prompt?: string })?.prompt;
        const detail = sql ? ` ${truncate(sql.replace(/\s+/g, " "))}` : prompt ? ` "${truncate(prompt, 80)}"` : "";
        console.log(`→ ${name}${detail}`);
      }
      if (event_type === "subagent_invoked") console.log(`  ⟳ discover: "${truncate(String((data as { prompt?: string }).prompt ?? ""), 80)}"`);
      if (event_type === "text_delta") process.stdout.write((data as { text: string }).text);
    },
  };
}

const SYSTEM_PROMPT = `You are a revenue-operations analyst with access to a LARGE catalogue of MCP providers,
but NONE are loaded yet. To use a provider you must first ACTIVATE it via the discovery subagent:
  glove_invoke_subagent({ name: "discovermcp", prompt: "<the capabilities you need>" })
Activated tools appear on your NEXT turn, namespaced like crm__list_accounts.

Each provider tool returns a LARGE full-dump payload, but results are CONTAINED in a scratchpad:
only a small stub returns to you. Never read a whole payload. Work data through the scratchpad
tools: describe the shape, narrow/JOIN with scratchpad_query (pass \`store\` to persist a derived
reference), and materialize only the final small result. Join providers on the account_id column.`;

const OBJECTIVE = `Build a Q3 enterprise churn-risk board.

First, in a SINGLE discovermcp call, activate the capabilities for: customer accounts (CRM),
engineering issues, support tickets, billing/invoices, and product-usage analytics. Do NOT
activate HR, inventory, calendar, docs, or email — they are irrelevant here.

Then load each provider into the scratchpad and, in SQL, build a board of ENTERPRISE accounts
with these per-account signals: number of open P0 issues, number of open high-severity support
tickets, number and total amount of overdue invoices, and the 30-day usage trend %. Flag any
enterprise account with at least one of: an open P0, an open high-severity ticket, an overdue
invoice, or a negative usage trend.

Report how many accounts are flagged and the total ARR at risk, then list the top 8 flagged
accounts by ARR with their signals and a one-line reason each. Narrow in SQL; only materialize
the final board.`;

main().catch((err) => {
  console.error("\n[fatal]", err);
  process.exit(1);
});
