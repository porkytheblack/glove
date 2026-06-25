# Scratchpad × MCP — a real cross-system workflow

An end-to-end example that composes **[`glove-scratchpad`](../../packages/glove-scratchpad)**
with **[`glove-mcp`](../../packages/glove-mcp)** and a real model (via OpenRouter).
It mirrors a task people actually run: pull from two SaaS systems, correlate them,
and answer a business question — **without dragging either full payload through the
model's context**.

## The scenario

Two dummy MCP servers stand in for tools a team would really wire up:

| Server | Tool | Returns |
| ------ | ---- | ------- |
| **issue tracker** (Linear/Jira-like) | `issues__search_issues` | every issue (~600), with `account_id`, `state`, `priority`, … |
| **CRM** (Salesforce/HubSpot-like) | `crm__list_accounts` | every account (~250), with `tier`, `arr`, `region`, … |

Both are **genuine MCP servers** — `@modelcontextprotocol/sdk` over Streamable HTTP,
in-process on ephemeral localhost ports. `glove-mcp`'s `connectMcp` talks to them
exactly as it would to a hosted server; only the data behind the tools is synthetic.

The agent's objective:

> Prepare a "revenue at risk" briefing: which **enterprise** accounts have an **open P0**
> issue, what's the **total ARR** at risk, and the **top 5** such accounts by ARR with
> their open-P0 count.

That requires loading two big payloads **and joining them** — the case the scratchpad
is built for.

## How it's wired (one call per server)

```ts
import { connectMcp } from "glove-mcp";
import { mountContainedMcp, createContainmentReporter } from "glove-scratchpad/mcp";

const reporter = createContainmentReporter();
const conn = await connectMcp({ namespace: "crm", url });
await mountContainedMcp(agent, conn, { scratchpad: sp, onContain: reporter.onContain });
mountScratchpad(agent, { scratchpad: sp });   // surface tools + restraint priming
// …after the run:
console.log(reporter.format());  // "2 call(s) · 155 KB contained → 3 KB emitted (46× less)"
```

`mountContainedMcp` lists the server's tools, bridges each one, wraps it in
`storeAndTruncate`, and folds it — so each full MCP result is written into the
scratchpad and only a **stub** (reference + descriptor + "read more") returns to the
model. The agent then `describe` → `query` (narrow/JOIN in SQL, persist new
references) → `materialize` only the final small table. `createContainmentReporter`
tallies the bytes kept out of context.

> Under the hood that's the per-tool primitive the package leads with —
> `storeAndTruncate(bridgeMcpTool(conn, tool, serverMode), { scratchpad })` — applied
> across the whole connection so you never hand-roll the loop.

## Run it

Uses `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` from the **repo-root `.env`**
(a local `.env` in this folder overrides). The script rebuilds `glove-core`,
`glove-mcp`, and `glove-scratchpad` first so you're always testing current source.

```bash
pnpm scratchpad:mcp
```

You'll see the tool trace — two contained payloads, the SQL the model writes to
narrow and join, and a last-mile materialize — followed by a context accounting:

```
CONTEXT ACCOUNTING
  naive (MCP payloads dumped to context)   : ~180,000 b
  scratchpad (stubs + SQL reads in context):   ~4,000 b
  reduction                                : ~45× less context from tools
```

(Exact numbers depend on the model's query plan; the data is seeded, the payloads
are not.)

## Files

| File | What |
| ---- | ---- |
| `data.ts` | Seeded generators for the accounts + issues (they join on `account_id`). |
| `mcp-servers.ts` | Two real Streamable-HTTP MCP servers, in-process. |
| `agent.ts` | Connect → bridge → contain → mount scratchpad → drive with OpenRouter. |

## Why this is the right test for the scratchpad

The context savings usually credited to "code execution for MCP" come from
**result containment** (don't round-trip intermediate tool results through the
model) and **narrowing before reading**. This example exercises exactly that path
over the genuine MCP transport, across **two** sources that must be joined — so the
scratchpad has to earn its keep, not just shrink one payload.
