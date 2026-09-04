# Hermes on Glove Foundry

This is a Foundry-native reference implementation of a capable personal agent in the spirit of [Nous Research's Hermes Agent](https://github.com/NousResearch/hermes-agent). It is an original example, not a fork and not affiliated with Nous Research.

The example is intentionally end to end. It uses the same public definitions, adapters, server, client, execution path, and observability stream that an application built on Foundry would use in production.

## What it demonstrates

| Hermes-style capability | Foundry implementation |
| --- | --- |
| Persistent personal conversations | One mutable agent instance with multiple first-class conversations and a conversation-scoped Glove store |
| Learning and durable context | Definition-owned entity, episodic, resource, and ambient-context memory, plus a persisted working environment |
| Adaptive execution | The agent chooses tools, skills, and isolated subagents from the current message instead of entering a hard-coded workflow |
| Terminal and files | Sandboxed VFS, document/spreadsheet standard libraries, named scripts, and a JavaScript workflow REPL |
| Delegation | Request-aware `researcher` and `reviewer` subagents with observable start/completion events |
| Messaging gateway | A dynamically installed, provider-neutral application with chat, file-drop, and notification transmissions |
| Proactive work | A predefined daily review plus agent-created, listed, updated, cancelled, and sleeping activations |
| Extensibility | Instance-installed tools and applications, an optional MCP definition, lazy inboxes, layers, subscribers, and typed calls |
| Media | Dynamically mounted `glove-image` generation/curation backed by Gemini or a deterministic local fixture |
| Inspection | Foundry's live workbench, HTTP client, manifest, run history, and correlated event stream |

Credentials remain outside Foundry. `lib/account-sessions.ts` is the consumer-owned boundary where a real deployment would resolve an opaque account reference into a provider session and handle refresh.

## Project anatomy

```text
agents/hermes/
  agent.ts                         lazy assembly and run behavior
  composition.ts                   colocated capability catalogue
  instances.ts                     seed data, not agent definition
  apps/
    media-studio.app.ts            dynamically installed image surface
    messaging.app.ts               owns multiple transmissions
    messaging/{events,actions,predicates,transmissions}/
  tools/                            instance-installable shared tools
  memory/personal.memory.ts        definition-owned memory
  mcp/external-tools.mcp.ts        optional and uninstalled by default
  schedules/daily-review.ts        agent-local desired schedule
  layers/                           per-run native Glove setup
  subscribers/                     safe trace projection
  skills.ts                        message-selected skills
  topology.ts                      runtime account and route seed data
  workbench.ts                     VFS, document tools, and REPL
foundry.application.ts             adapters, topology, bindings, seed data
foundry.config.ts                  typed Foundry configuration
scripts/verify.ts                  real server/client E2E verification
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

Open `http://127.0.0.1:4244`. With no key, the example uses a deterministic local model and image adapter so the complete runtime remains testable offline.

For Gemini text and image generation, set `GEMINI_API_KEY` in `.env`. For OpenRouter text with Gemini image generation, also set `OPENROUTER_API_KEY` and select `HERMES_TEXT_PROVIDER=openrouter`. The model and image adapter choices are configurable in `.env.example`.

Useful prompts:

```text
Inspect your current capabilities and report readiness.
Delegate to @researcher: compare two approaches and save the recommendation in /out.
Generate an image for this concept, review it, and explain the strongest direction.
Create a recurring weekly project review and tell me how to cancel it.
Use the working environment to build a launch brief as a document.
```

## Verify it

The deterministic suite starts an ephemeral Foundry server and crosses its public client/API boundary:

```bash
pnpm --filter glove-foundry-hermes-example typecheck
pnpm --filter glove-foundry-hermes-example lint
pnpm --filter glove-foundry-hermes-example verify
```

It checks discovery and file identity, mutable application installation, multiple conversations, lazy playbook materialization, inbound filtering, outbound delivery, subagent delegation, media tooling, VFS persistence, the REPL, a predefined schedule, a dynamically created and cancelled schedule, sleep/wake persistence, and correlated run events.

To smoke-test the configured network model instead of the deterministic adapter, export the key in your shell and run:

```bash
pnpm --filter glove-foundry-hermes-example verify:live
```

The bundled data, memory, delivery, and image stores are intentionally in-memory adapters. Replace them in `foundry.application.ts` and `lib/` with durable, provider-owned adapters without changing the agent definition.
