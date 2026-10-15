---
"glove-foundry": patch
---

Starter template READMEs: explain that composed shared tools, apps and MCP servers mount only after an instance installs them (the inspector displays installations but does not change them), and that each run executes in its own process, so the starters' in-memory `MemoryStore` forgets earlier turns until the agent has a durable store.
