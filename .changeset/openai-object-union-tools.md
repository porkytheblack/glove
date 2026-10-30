---
"glove-core": patch
"glove-realtime": patch
---

Normalize object-union tool schemas for OpenAI-compatible and realtime function calls. Merge their properties into an object-shaped wire schema, while retaining the original discriminated-union validation in the tool executor. This fixes OpenAI rejecting built-in Foundry tools such as schedule management.
