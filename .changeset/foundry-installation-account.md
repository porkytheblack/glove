---
"glove-foundry": patch
---

An app installed with an account now gets `withAccountSession` inside a run. The run's envelope dropped the installation's `accountId`, so app tools that need the account's session saw it as missing.
