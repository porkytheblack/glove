# glove-memory

## 0.6.0

### Minor Changes

- [#38](https://github.com/porkytheblack/glove/pull/38) [`fb2d7ca`](https://github.com/porkytheblack/glove/commit/fb2d7ca8647a1625b8fd65e9ceee2fa0e13b57f5) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Episodic memory: embedding-free fuzzy search. `InMemoryEpisodicAdapter` now accepts `fuzzySearch: true` (no embedder) to run in-process lexical/fuzzy matching over episode content — exact-phrase and substring hits plus a bigram-Dice typo-tolerant fallback. It sets `supportsSemanticSearch: true` (so `glove_episodic_search` is registered) with zero external services, no vectors, and no out-of-band embed loop. `embedder` still takes precedence when both are supplied. Clarifies that `supportsSemanticSearch` advertises that `searchEpisodes` is callable, not how it ranks, so BYO adapters can offer fuzzy, embedding, or hybrid search behind the same contract.
