---
"glove-react": minor
---

First-class conversation/session management in `useGlove` — no more sessionId plumbing:

- **Zero-config sessions**: `useGlove()` no longer throws when no `sessionId` / `getSessionId` / `store` is configured — a fresh `glove_<uuid>` is generated automatically.
- **`newConversation(id?)`**: start a fresh conversation in place. Mints an id (explicit arg → `GloveClient.createSessionId` → generated uuid), aborts in-flight requests, resets the timeline, and rebuilds the store/agent. Returns the new session id.
- **`switchConversation(id)`**: switch to an existing conversation in place — store swap + timeline rehydration, no `key=` remount tricks.
- **Reactive `sessionId` prop**: passing a different `sessionId` to `useGlove` now switches the conversation (previously the initial value was frozen and consumers had to remount).
- **`onSessionChange(sessionId)`** config callback: fires whenever the active session resolves or changes (initial async resolution included) — replaces hand-rolled "session resolved" notification effects.
- **`persistSession`** (client or hook config): opt-in localStorage persistence of the active session id so reloads resume the same conversation (pair with a persistent store). `true` or `{ storageKey }`.
- **`GloveClient.createSessionId`**: factory for minting new-conversation ids (e.g. create the session row on your backend first).
- **`generateSessionId()`** exported for apps that want to mint ids with the same shape.
- UI state (timeline, stats, tasks, inbox, slots) now resets correctly when the session changes in place.
