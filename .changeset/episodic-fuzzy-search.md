---
"glove-memory": minor
---

Episodic memory: embedding-free fuzzy search. `InMemoryEpisodicAdapter` now accepts `fuzzySearch: true` (no embedder) to run in-process lexical/fuzzy matching over episode content — exact-phrase and substring hits plus a bigram-Dice typo-tolerant fallback. It sets `supportsSemanticSearch: true` (so `glove_episodic_search` is registered) with zero external services, no vectors, and no out-of-band embed loop. `embedder` still takes precedence when both are supplied. Clarifies that `supportsSemanticSearch` advertises that `searchEpisodes` is callable, not how it ranks, so BYO adapters can offer fuzzy, embedding, or hybrid search behind the same contract.
