# Scratchpad Computer example

Two ways to see [`glove-scratchpad`](../../packages/glove-scratchpad) work.

## `demo.ts` — mechanism walkthrough (no API key)

Drives the store + tools directly and prints **real byte counts** for what the
model's context would carry naively (full payload) vs. with the scratchpad
(stubs + one bounded last-mile read). Also snapshots and restores the store.

```bash
pnpm scratchpad:demo
```

Expected: a ~37× context reduction on a 500-issue payload, end to end.

## `agent.ts` — live agent (requires `ANTHROPIC_API_KEY`)

A real Glove agent whose only data source is a tool returning a large payload.
The tool is wrapped with `storeAndTruncate`, and the agent is mounted with the
scratchpad surface tools + restraint priming. The tool log shows the agent
`describe` → `query` (narrow in SQL) → `materialize` a small slice, instead of
reading the whole payload.

```bash
export ANTHROPIC_API_KEY=sk-...
pnpm scratchpad:agent
```
