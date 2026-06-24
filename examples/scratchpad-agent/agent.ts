/**
 * The Scratchpad Computer — live agent (requires ANTHROPIC_API_KEY).
 *
 * A server-side Glove agent whose only data source is a tool that returns a
 * large payload. The tool is wrapped with `storeAndTruncate`, and the agent is
 * mounted with the scratchpad surface tools + restraint priming. Watch the tool
 * log: the agent describes → narrows in SQL → materializes a small slice,
 * instead of dragging the whole payload through context.
 *
 * Run: `pnpm scratchpad:agent` (from the repo root) with ANTHROPIC_API_KEY set.
 */
import { Glove, Displaymanager, MemoryStore } from "glove-core";
import { createAdapter } from "glove-core/models/providers";
import type { SubscriberAdapter } from "glove-core";
import { Scratchpad, storeAndTruncate, mountScratchpad } from "glove-scratchpad";
import { PgliteBackend } from "glove-scratchpad/pglite";

function fakeIssues(): unknown {
  const labels = ["bug", "p0", "p1", "p2", "ui", "infra", "docs"];
  return Array.from({ length: 500 }, (_, i) => ({
    id: 1000 + i,
    title: `Issue ${i}: attention needed in module ${i % 17}`,
    state: i % 3 === 0 ? "open" : "closed",
    priority: i % 5 === 0 ? "P0" : i % 2 === 0 ? "P1" : "P2",
    assignee: `dev-${i % 11}`,
    labels: labels.filter((_, k) => (i + k) % 3 === 0),
  }));
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Set ANTHROPIC_API_KEY to run the live agent. (Try `pnpm scratchpad:demo` for the no-key walkthrough.)");
    process.exit(1);
  }

  const sp = await Scratchpad.create(await PgliteBackend.create());

  const log: SubscriberAdapter = {
    async record(event_type, data) {
      if (event_type === "tool_use") console.log(`\n[tool] ${(data as { name: string }).name}`);
      if (event_type === "text_delta") process.stdout.write((data as { text: string }).text);
    },
  };

  const agent = new Glove({
    store: new MemoryStore("scratchpad-demo"),
    model: createAdapter({ provider: "anthropic", model: "claude-sonnet-4-20250514", stream: true }),
    displayManager: new Displaymanager(),
    serverMode: true,
    systemPrompt:
      "You are an issue-triage assistant. Use the scratchpad tools to work over large tool results efficiently.",
    compaction_config: { compaction_instructions: "Summarize the work so far." },
  }).build();

  agent.addSubscriber(log);

  // The data source: a big payload, contained on return.
  agent.fold(
    storeAndTruncate(
      {
        name: "issues__search",
        description: "Search the issue tracker. Returns all issues.",
        inputSchema: (await import("zod")).z.object({}),
        async do() {
          return { status: "success", data: JSON.stringify(fakeIssues()) };
        },
      },
      { scratchpad: sp, actor: "triage" },
    ),
  );

  // Surface tools + restraint priming.
  mountScratchpad(agent, { scratchpad: sp, actor: "triage" });

  await agent.processRequest(
    "Call issues__search, then tell me how many OPEN P0 issues are assigned to dev-0, and list their titles. Don't read the whole payload — narrow in SQL first.",
  );

  console.log("\n");
  await sp.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
