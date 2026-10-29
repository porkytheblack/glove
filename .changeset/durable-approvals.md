---
"glove-foundry": minor
---

Pending approvals are stored on the data adapter and survive a restart. They no longer expire after five minutes unless `defineApplication` sets `approvals.timeoutMs`. Resolving one after the waiting run is gone starts a continuation run in the same conversation. Expiry, cancel, and steer still fail closed.
