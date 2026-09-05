# Hermes on Glove Foundry

This is a Foundry-native reference implementation of a capable personal agent in the spirit of [Nous Research's Hermes Agent](https://github.com/NousResearch/hermes-agent). It is an original example, not a fork and not affiliated with Nous Research.

The example is intentionally end to end. It uses the same public definitions, adapters, server, client, execution path, and observability stream that an application built on Foundry would use in production.

## What it demonstrates

| Hermes-style capability | Foundry implementation |
| --- | --- |
| Persistent personal conversations | One mutable agent instance with multiple first-class conversations and an atomic file-backed Glove store |
| Learning and durable context | Definition-owned entity, episodic, resource, and ambient-context memory, plus a durably snapshotted working environment |
| Adaptive execution | The agent chooses tools, skills, and isolated subagents from the current message instead of entering a hard-coded workflow |
| Terminal and files | Sandboxed VFS, document/spreadsheet standard libraries, named scripts, and a JavaScript workflow REPL |
| Delegation | Request-aware `researcher` and `reviewer` subagents with observable start/completion events |
| Messaging gateway | A dynamically installed application with local and real Telegram Bot API adapters, supervised inbound polling, outbound replies, file-drop, and notifications |
| Proactive work | A predefined daily review plus agent-created, listed, updated, cancelled, and sleeping activations |
| Extensibility | Instance-installed tools and applications, an optional MCP definition, lazy inboxes, layers, subscribers, and typed calls |
| Media | Dynamically mounted `glove-image` generation/curation backed by Gemini or a deterministic local fixture, with file-backed assets and library data |
| Inspection | Foundry's live workbench, HTTP client, manifest, run history, and correlated event stream |

Credentials remain outside Foundry. `lib/account-sessions.ts` is the consumer-owned boundary that resolves an opaque account reference into an operation-scoped provider session. The Telegram token is never placed in Foundry data, manifests, routes, events, or agent context.

## Project anatomy

```text
agents/hermes/
  agent.ts                         lazy assembly and run behavior
  composition.ts                   colocated capability catalogue
  instances.ts                     seed data, not agent definition
  apps/
    media-studio.app.ts            dynamically installed image surface
    messaging.app.ts               owns multiple transmissions
    messaging/connections/         supervised provider ingress
    messaging/{events,actions,predicates,transmissions}/
  tools/                            instance-installable shared tools
  memory/personal.memory.ts        definition-owned memory
  mcp/external-tools.mcp.ts        optional and uninstalled by default
  schedules/daily-review.ts        agent-local desired schedule
  layers/                           per-run native Glove setup
  subscribers/                     safe trace projection
  subscriptions/                   boot-time, file-routed inbound policy
  skills.ts                        message-selected skills
  topology.ts                      runtime account and route seed data
  workbench.ts                     VFS, document tools, and REPL
foundry.application.ts             adapters, topology, bindings, seed data
foundry.config.ts                  typed Foundry configuration
scripts/verify.ts                  real server/client E2E verification
scripts/verify-messenger.ts        fake Telegram protocol E2E verification
Dockerfile + compose.yaml          single-node deployment reference
```

Static definition identity comes from file routes. For example, `tools/status.tool.ts` becomes `status` and exports only the ordinary Glove tool body. Relationships in code use imported objects such as `messaging`, `chat`, and `chatInbound`; duplicated definition-id strings are not used. Explicit string IDs appear only on mutable data records such as an instance, conversation, route, account, or binding.

## Run it

From the repository root:

```bash
pnpm install
cp examples/foundry-hermes-agent/.env.example examples/foundry-hermes-agent/.env
pnpm --filter glove-foundry build
pnpm --filter glove-foundry-hermes-example dev
```

Open `http://127.0.0.1:4244`. With no model key, the example uses deterministic local model and image adapters so the complete runtime remains testable offline. Operational state is written beneath `HERMES_DATA_DIR` (default `.data`).

For Gemini text and image generation, set `GEMINI_API_KEY` in `.env`. For OpenRouter text with Gemini image generation, also set `OPENROUTER_API_KEY` and select `HERMES_TEXT_PROVIDER=openrouter`. The model and image adapter choices are configurable in `.env.example`.

Useful prompts:

```text
Inspect your current capabilities and report readiness.
Delegate to @researcher: compare two approaches and save the recommendation in /out.
Generate an image for this concept, review it, and explain the strongest direction.
Create a recurring weekly project review and tell me how to cancel it.
Use the working environment to build a launch brief as a document.
```

You can also cross the public API directly:

```bash
curl -sS http://127.0.0.1:4244/api/conversations/hermes-main/messages \
  -H 'content-type: application/json' \
  -d '{"agentId":"hermes-primary","message":"Inspect your current capabilities."}'
```

## Telegram messenger

Credential acquisition remains your responsibility. Create a bot with Telegram, then configure the host-owned adapter:

```dotenv
HERMES_MESSENGER_PROVIDER=telegram
TELEGRAM_BOT_TOKEN=replace-me
```

Start Foundry and send the bot a message containing `Hermes`. The file-routed `operator-messages.subscription.ts` activates the provider connection during runtime startup—no warm-up agent run is required. The connection validates the bot with `getMe`, uses supervised long polling for `getUpdates`, deduplicates updates through Foundry delivery claims, creates a conversation per Telegram chat, runs Hermes, and sends the completed answer to the same chat with `sendMessage`.

`TELEGRAM_API_BASE_URL` exists for compatible gateways and protocol tests; leave it unset for Telegram. To add another messenger, implement a colocated connection and transmission adapter while retaining the same app, account-session, route, playbook, and grant boundaries.

## Verify it

The deterministic suite starts an ephemeral Foundry server and crosses its public client/API boundary:

```bash
pnpm --filter glove-foundry-hermes-example typecheck
pnpm --filter glove-foundry-hermes-example lint
pnpm --filter glove-foundry-hermes-example test
```

The test command runs two end-to-end suites. The core suite checks discovery and file identity, durable instance reconstruction, mutable application installation, multiple conversations, lazy playbooks, inbound filtering, automatic outbound replies, subagent delegation, file-backed media, VFS persistence, the REPL, predefined and dynamic schedules, sleep/wake persistence, and correlated run events. The messenger suite runs a local Telegram-compatible API and verifies boot-time connection, real `getUpdates` ingress, an agent run, real `sendMessage` egress, and account-session credential isolation.

To smoke-test the configured network model instead of the deterministic adapter, export the key in your shell and run:

```bash
pnpm --filter glove-foundry-hermes-example verify:live
```

## Ship it

From the repository root:

```bash
docker compose -f examples/foundry-hermes-agent/compose.yaml up --build -d
curl -fsS http://127.0.0.1:4244/health
```

The image runs the production `glove foundry start` command, handles `SIGTERM`, includes a health check, and persists `/data` in the `hermes-data` volume. The compose port is intentionally bound to host loopback. Put an authenticated reverse proxy in front of the inspector/API before exposing it to a network.

`FileFoundryDataAdapter`, conversation history, VFS snapshots, schedules, sleep records, inbox/tasks, and image assets survive restarts on a single host. Back up `HERMES_DATA_DIR` as one unit. For multi-host replicas, replace the file adapters with transactional database/object-store adapters. The example's entity, episodic, resource, and ambient-context memory implementations remain the package's reference in-process adapters; swap those four factories in `personal.memory.ts` for your durable memory backend without changing the agent definition.
