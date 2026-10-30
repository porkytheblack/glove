---
"glove-core": patch
"glove-realtime": patch
---

Normalize object-union tool schemas at OpenAI-compatible and OpenAI realtime provider boundaries. Preserve common root fields and constraints when merging branch properties into an object-shaped wire schema, while retaining the original Zod discriminated-union validation in the executor. Custom realtime adapters keep the original schema; raw JSON Schema tools retain their existing pass-through validation behavior. This fixes OpenAI rejecting built-in Foundry tools such as schedule management.
