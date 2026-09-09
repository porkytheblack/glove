---
"glove-foundry": minor
"glove-core": minor
"glove-memory": minor
"glove-mcp": minor
"glove-js": minor
"glove-python": minor
"glove-lisp": minor
---

Integrate Foundry's production application controls with the current core runtime-context and multimodal contracts. Add durable single-host Foundry data, authoritative conversation transcripts, adapter-owned HTTP authorization, expiring tool approvals, interrupt-and-restart steering, and bounded programmatic tool composition. Preserve message-aware assembly, schedules, sleep, native working environments, and voice host boundaries.

Add first-class lazy goals, facts, forms and native context-provider fields with typed execution handles, conversation/instance scoping, opt-in shared preparation, and metadata-only inspector progress. Extend the SQLite bundle with durable native goal/form adapters and independently committed fact saves protected by process-death-safe SQLite locks. Add guided-intake documentation and restart/concurrency tests.

Require Station 2.3.0 or newer for completed-worker drain and cancellation escalation fixes. Add a real-process regression for leaked handles and cancellation.

Add a Clack-based interactive project initializer with target, starter and package-manager choices, a review before writing files, cancellation and optional dependency installation. Preserve non-interactive automation with explicit flags. Require Node 20.12+ for the initializer (Node 22.13+ recommended for SQLite memory). Resolve scaffold versions against the installed workspace instead of obsolete fallback majors. Expand the package and starter READMEs and the documentation site's setup wizard and CLI reference.

Add opt-in `glove-memory/sqlite` durable entity, episodic, resource and pinned-context adapters for Node 22.13+ with isolated namespaces, transactional writes, cross-process reads and corruption checks. Existing browser-safe entry points remain unchanged.

Add MCP stdio transport, tool allowlists, sanitized resources and prompts, bounded timeouts, lease-safe child recycling, live tool refresh and deactivation cleanup. Core tool-registry updates are atomic; Gemini compatibility retains provider thought signatures across tool turns. REPL workflow frames remain bounded and capability-selected.
