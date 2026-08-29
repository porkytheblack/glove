# Glove Foundry reference application

This is the executable companion to the [building guide](../../packages/glove-foundry/docs/building-with-foundry.md) and [architecture reference](../../packages/glove-foundry/docs/architecture.md).

It demonstrates:

- filename-owned identities for agents and every colocated static primitive;
- message-aware lazy model, prompt, tools, memory, inbox, layer, subscriber, calls, and custom handler assembly;
- colocated tools, MCP, memory, app, transmission, connection, and schedule primitives;
- direct imported references normalized to ids only at the persistence boundary;
- schema-inferred installation, account metadata, and route config;
- instance-owned installations plus playbooks composed lazily from transmission primitives;
- a runtime-created per-thread playbook subscription that can provision an instance from an inbound event;
- multiple inbound/outbound transmissions owned by an installable app;
- account metadata with credential lifecycle delegated to a user adapter;
- an agent-local schedule loaded through the lazy definition resolver;
- a native Glove working environment with a guarded VFS, script execution, and verb telemetry;
- a message-aware JavaScript REPL assembled with request-specific functions;
- a typed client and correlated inspector trace; and
- a deterministic local model when no API key is present.

## Verify

```bash
pnpm --filter glove-foundry-example typecheck
pnpm --filter glove-foundry-example verify:architecture
pnpm --filter glove-foundry-example verify
```

The architecture check validates the application/transmission manifest and proves a process API key value is never copied into it. The runtime check starts the real Foundry server, updates instance installations, executes direct and inbound runs, verifies subscription fan-out, and checks observability.

## Run with OpenRouter

```bash
export OPENROUTER_API_KEY=...
export OPENROUTER_MODEL=openai/gpt-4.1-mini # optional
pnpm --filter glove-foundry-example verify:live
```

Or start the inspector:

```bash
pnpm --filter glove-foundry-example dev
```

Open [http://127.0.0.1:4242](http://127.0.0.1:4242).

The primary activation endpoints are:

```text
POST /api/agent-instances
POST /api/conversations
POST /api/conversations/:conversationId/messages
POST /api/transmissions/:routeId/fire
```

Background state is visible at:

```text
GET /api/playbook-subscriptions
GET /api/application-connections
GET /api/runs
GET /api/events
```
