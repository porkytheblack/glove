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

```bash
pnpm scratchpad:mcp-smoke   # no API key — deterministic datapath + byte accounting
pnpm scratchpad:mcp         # live, via OPENROUTER_API_KEY / OPENROUTER_MODEL (repo-root .env)
```

**`smoke.ts`** (no key) is the reproducible path: it connects the two dummy MCP
servers, contains their payloads, runs the cross-provider SQL JOIN, and prints the
byte accounting. Because the data is seeded, the numbers are deterministic:

```
CONTEXT ACCOUNTING (no model)
   containment: 2 call(s) · 155.3 KB contained → 3.4 KB emitted (46.0× less)
   total tool→context vs naive               : 3,627 b vs 159,043 b
```

**`agent.ts`** (live) drives the same flow with a model — you see the tool trace
(two contained payloads, the SQL it writes to narrow and join, a last-mile
materialize) and a `CONTAINMENT` line (`2 call(s) · 155.3 KB contained → 3.4 KB
emitted (~46× less)`). The payloads are deterministic; only the model's query plan
(and thus the exact in-context read size) varies.

## Files

| File | What |
| ---- | ---- |
| `data.ts` | Seeded generators for the accounts + issues (they join on `account_id`). |
| `mcp-servers.ts` | Two real Streamable-HTTP MCP servers, in-process. |
| `smoke.ts` | No-API-key: contain → JOIN → accounting (the deterministic reproduction). |
| `agent.ts` | Connect → bridge → contain → mount scratchpad → drive with OpenRouter. |

## Why this is the right test for the scratchpad

The context savings usually credited to "code execution for MCP" come from
**result containment** (don't round-trip intermediate tool results through the
model) and **narrowing before reading**. This example exercises exactly that path
over the genuine MCP transport, across **two** sources that must be joined — so the
scratchpad has to earn its keep, not just shrink one payload.
