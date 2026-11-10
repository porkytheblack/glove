---
"glove-foundry": minor
---

- **Mailbox names:** mailbox directories and lease files are now named with the sha256 of the conversation or run id, so a live run in a conversation whose id is over 127 bytes can take deliveries. Before, the hex of the id passed the 255-byte name limit and the write failed with `ENAMETOOLONG`.
- **A person's mesh message mid-run:** when a person's mesh message is delivered into a live run, it now keeps `from.kind` and `peer`.
- **New thread routes:** mesh threads now have HTTP routes and typed-client methods: `GET /api/threads`, `GET /api/threads/:id`, `POST /api/threads/:id/messages`, `POST /api/threads/:id/take-over` and `POST /api/threads/:id/held/:messageId`. The client methods are `threads`, `thread`, `meshHumanMessage`, `meshTakeOver` and `releaseMeshMessage`.
- **Subscription fan-out:** a subscription's playbook no longer wakes every instance it provisioned. Only the subscription routes it, by its targets, so an event for one thread wakes that thread's instances.
