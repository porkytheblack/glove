---
"glove-core": patch
---

Register `glove_post_to_inbox` when the store implements the inbox.

The docs, the agent skills and the coffee example have long said that a store with `getInboxItems`, `addInboxItem`, `updateInboxItem` and `getResolvedInboxItems` gives the agent the `glove_post_to_inbox` tool, the way task methods give it `glove_update_tasks`. Glove never registered it: `createInboxTool` was exported but nothing called it, so the model could not post inbox items. A Glove whose store implements all four methods (`MemoryStore` does) now registers the tool on construction and rebinds it to the store passed to `build`, exactly as the task tool does. Agents whose stores lack any of the four are unchanged.

Also corrects the Anthropic Haiku 3.5 id in the provider registry's model list (`claude-3-5-haiku-20241022`).
