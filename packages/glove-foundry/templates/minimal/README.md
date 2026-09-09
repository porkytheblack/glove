# {{projectName}}

A [Glove Foundry](https://github.com/porkytheblack/glove/tree/main/packages/glove-foundry) application.

## First run

Use Node.js 22.13+ (recommended; minimum 20.12). This minimal starter needs an
OpenRouter key. For a keyless first look, choose the guided travel-concierge
template instead. Run these commands from this project's directory; skip
installation if you already accepted it in the setup wizard.

```bash
cp .env.example .env.local     # add your OPENROUTER_API_KEY
{{installCommand}}
{{devCommand}}
```

Then open **http://127.0.0.1:4141** and press **Start a run**.

Choose **assistant**, send a short request, and open the run to inspect its events.
Edit `agents/assistant/agent.ts`, save, and run again. The dev server reloads your
definition. Run `{{typecheckCommand}}` and `{{lintCommand}}` after changes.

The initializer never asks for secrets. Add `OPENROUTER_API_KEY` to `.env.local`
yourself and restart the dev server. Do not commit the key. If a run fails, check
the trace for authentication or rate-limit errors. If port 4141 is occupied, use
the local `glove foundry dev --port 4142` command.

## Before using real data

The starter uses disposable in-memory storage. Configure durable Foundry runtime
data, a durable Glove conversation store, native memory adapters, and VFS
persistence independently. For a single host, Foundry includes
`FileFoundryDataAdapter`; `glove-memory/sqlite` supports Node 22.13+. Use your own
transactional adapters across hosts. A non-loopback listener requires an
application-owned `requestAuthorization` adapter and a deliberate network boundary.

## The one idea to understand first

Foundry separates a **definition** (code — what an agent can assemble, at `agents/assistant/agent.ts`) from an **instance** (data — one persisted identity with its own context, installed apps, and conversations). One definition serves many instances.

**The filesystem is the registry.** `agents/assistant/agent.ts` *is* the agent `assistant`. There are no string ids to keep in sync.

## Adding capabilities

Any file matching these names under an agent folder is discovered automatically. Each default-exports one definition, and the **filename becomes its id**.

| File | Defines | Helper |
| --- | --- | --- |
| `agent.ts` | The agent | `defineAgent` |
| `tools/*.tool.ts` | A tool any agent can mount | `defineSharedTool` |
| `apps/*.app.ts` | An installable capability bundle | `defineApp` |
| `transmissions/*.transmission.ts` | An external transport shape | `defineTransmission` |
| `events/*.event.ts` | A transmission event | `defineTransmissionEvent` |
| `predicates/*.predicate.ts` | An inbound match rule | `defineTransmissionPredicate` |
| `mcp/*.mcp.ts` | An MCP server entry | `defineMcp` |
| `memory/*.memory.ts` | A memory profile | `defineMemory` |
| `layers/*.layer.ts` | Native Glove setup | `defineLayer` |
| `subscribers/*.subscriber.ts` | An observer | `defineSubscriber` |

Create the file, add it to `composeAgent(...)`, and the dev server picks it up and regenerates types.

Schedules are data, not auto-discovered file routes. You may keep a `defineSchedule`
value in an ordinary colocated module and import it into the agent's lazy
`schedules` field, or create future work dynamically with Foundry's scheduling tools.

Want a worked example with a calendar application, a chat transport, memory, a schedule, and a sandboxed REPL? Scaffold the travel concierge:

```bash
npx glove-foundry init my-concierge --template travel-concierge
```

## Commands

| Command | What it does |
| --- | --- |
| `{{devCommand}}` | Discover agents, generate routes, serve the runtime and inspector |
| `{{startCommand}}` | Run without file watching |
| `{{lintCommand}}` | Lint, including the Foundry file-routing rules |
| `{{typecheckCommand}}` | `tsc --noEmit` |

## Documentation

- [Building with Foundry](https://github.com/porkytheblack/glove/blob/main/packages/glove-foundry/docs/building-with-foundry.md)
- [Architecture](https://github.com/porkytheblack/glove/blob/main/packages/glove-foundry/docs/architecture.md)
- [The inspector](https://github.com/porkytheblack/glove/blob/main/packages/glove-foundry/docs/inspector.md)
