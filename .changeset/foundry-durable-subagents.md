---
"glove-foundry": minor
"glove-core": minor
---

Add owned durable subagents to defineAgent, with reusable definitions, explicit memory/tool/app inheritance, restricted app views, persistent two-way messaging, and delegation to durable workers. Add worker inspection, archive/resume/purge APIs, ownership-aware cleanup, and per-definition run time and concurrency limits.

Route messages, task starts, and task updates through a shared durable event journal with explicit agent/conversation targeting, wake/defer/expiry policies, restart recovery and retained deduplication receipts. Deliver through native runtime events without mesh inboxes; add an awaited Glove processEvents turn for durable hosts.
