---
"glove-foundry": patch
---

Starter templates now work end to end on their first run:

- **Conversation history survives between messages.** Every run executes in its own process, so the templates' `new MemoryStore(...)` forgot earlier turns. Both templates now ship `lib/file-store.ts`, a file-backed transcript store, and use `FileFoundryDataAdapter`, so instances, conversations and schedules also survive the restart `dev` performs on every save. State lives under `.data/` (git-ignored; `foundry/.data/` with a nested `.gitignore` for the Next.js target).
- **The demo's tools are actually mounted.** `find_flights` (concierge) and `current_time` (minimal) were composed but never installed, so the model could not call them on a new instance. They are now always-on tools; the concierge keeps an installable shared-tool example (`convert-currency`).
- **The concierge can reply over its chat transport.** A seeded `concierge-demo` instance installs the calendar app and has the binding outbound delivery requires (previously `bindings: []`, so replies failed with "agent has no enabled bindings"). The keyless demo model now replies through the generated messaging tool when a chat message arrives.
- **Traveller memory and the working environment persist.** Memory uses a small file-backed context adapter (`lib/file-context.ts`) per instance, and the VFS uses `foundryDataEnvironmentPersistence`.
- The demo model reasons per turn, so it keeps calling tools after the first message.
- The minimal template no longer depends on `effect`; the Next.js README names `foundry.config.mts`.
- READMEs explain composing vs installing, where state lives, and how to send the demo a chat message.
