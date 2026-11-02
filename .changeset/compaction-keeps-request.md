---
"glove-core": patch
---

Compaction partway through a request keeps the request. The model sees nothing from before a compaction summary. So when compaction ran between a request's model calls, the request survived only as the summary's retelling of it, and a model could answer as if it had lost the thread. The summary now ends with the request, word for word. `Observer.runCompactionNow(current?)` and `tryCompaction(current?)` take it, and the agent loop passes the request it is working on. A compaction between requests is unchanged, and the request is still stored once, so a chat shows it once.
