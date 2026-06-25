# Scratchpad as a code-execution environment for 10+ MCP providers

The capstone example. It shows `glove-scratchpad` standing in for a code-execution
environment across a **fleet of 10 MCP providers**, combining the four things an
ambitious multi-provider action needs:

1. **Interface disclosure** — none of the 10 providers are loaded up front. The
   agent **discovers** the ones a task needs (via `glove-mcp`'s `discovermcp`
   subagent) instead of drowning in 10 providers' tool schemas.
2. **Result containment** — every activated tool's big payload is written to the
   scratchpad (`containingWrap`); only a stub reaches the model.
3. **Storable & resumable** — the scratchpad auto-persists as it fills, so a long
   multi-provider run survives a restart (`autoPersistScratchpad` + `restoreScratchpad`).
4. **Observability** — the scratchpad event stream + containment telemetry report
   what got contained, what SQL ran, and what failed.

## The fleet

Ten in-process Streamable-HTTP MCP servers (real `@modelcontextprotocol/sdk`):

| Relevant to the board | Distractors (in the catalogue, must NOT be activated) |
| --- | --- |
| `crm` · `issues` · `support` · `billing` · `analytics` | `hr` · `inventory` · `calendar` · `docs` · `email` |

The relevant five join on `account_id`. The five distractors make discovery a
real decision, not a formality.

## The task

> Build a Q3 enterprise churn-risk board: for each **enterprise** account, the
> open-P0 count, open high-severity tickets, overdue invoices (count + $), and
> 30-day usage trend; flag accounts with any risk signal; rank by ARR.

That's a **5-provider JOIN** the agent has to discover, contain, and narrow in SQL.

## Run it

```bash
pnpm scratchpad:fleet-smoke   # no API key — proves the datapath deterministically
pnpm scratchpad:fleet         # live, via OPENROUTER_API_KEY / OPENROUTER_MODEL
```

**`smoke.ts`** (no key) connects the 5 relevant providers, contains them, runs the
5-way JOIN, then persists + restores the whole scratchpad — deterministic ground
truth. **`agent.ts`** (live) loads the *full* catalogue with discovery, and the
model discovers → activates → contains → joins → materializes on its own. Both
land on the same board (33 flagged enterprise accounts, ~$8.78M ARR at risk).

## What to watch in the live trace

```
→ glove_invoke_subagent "Activate providers for accounts, issues, support, billing, analytics…"
  ⟳ discover → list_capabilities → activate ×5      # interface disclosure
→ crm__list_accounts … analytics__usage_by_account  # contained on return (30× less)
→ scratchpad_query  WITH p0 AS (… JOIN … )          # narrowed + joined in SQL
…
  containment : 5 call(s) · 163 KB contained → 5.5 KB emitted (30× less)
  scratchpad  : 5 ingests · 8 queries · … · 2 errors  # bad SQL surfaced + recovered
```

## Files

| File | What |
| --- | --- |
| `mcp-fleet.ts` | 10 dummy MCP servers + a `glove-mcp` catalogue pointing at them. |
| `adapter.ts` | An in-memory `McpAdapter` (active-state Set + constant token). |
| `smoke.ts` | No-key: contain 5 → 5-way JOIN → persist/restore. |
| `agent.ts` | Live: `mountMcp({ wrapTool: containingWrap(...) })` + discovery + persist + observe. |
