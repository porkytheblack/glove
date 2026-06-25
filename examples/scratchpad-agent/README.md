# Scratchpad Computer example

Three ways to see [`glove-scratchpad`](../../packages/glove-scratchpad) work. The
first two need no API key and no database — the default `MemoryBackend` is pure
JS with zero dependencies.

## `demo.ts` — mechanism walkthrough (no API key)

Drives the store + tools directly and prints **real byte counts** for what the
model's context would carry naively (full payload) vs. with the scratchpad
(stubs + one bounded last-mile read). Also snapshots and restores the store.

```bash
pnpm scratchpad:demo
```

Expected: a ~37× context reduction on a 500-issue payload, end to end.

## `graph.ts` — subagent graph from a schema object (no API key)

Defines a multi-subagent workflow as a plain `GraphDef` object and lets
`buildScratchpadGraph` construct the wired topology — folding each node's tool
slice (interface disclosure), mounting the scratchpad surface, and stamping
provenance. Prints the resulting nodes, tool slices, and edges.

```bash
pnpm scratchpad:graph
```

## `workflow.ts` — build and run a workflow in one call (no API key)

Drives the single `workflow_run` tool: it builds a three-subagent flow from a
schema object and runs it over the shared scratchpad until the objective
resolves — all in one call. The subagents are stubs whose turns are scripted
scratchpad ops, so it runs without a model — prints the topology, the per-step
trace (references flowing `issues → open → by_priority`), and the resolved answer.

```bash
pnpm scratchpad:workflow
```

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
