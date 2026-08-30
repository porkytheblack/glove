# {{projectName}}

A [Glove Foundry](https://github.com/porkytheblack/glove/tree/main/packages/glove-foundry) application.

```bash
cp .env.example .env.local     # add your OPENROUTER_API_KEY
{{installCommand}}
{{devCommand}}
```

Then open **http://127.0.0.1:4141** and press **Start a run**.

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
| `schedules/*.ts` | Recurring or future work | `defineSchedule` |

Create the file, add it to `composeAgent(...)`, and the dev server picks it up and regenerates types.

Want a worked example with a calendar application, a chat transport, memory, a schedule, and a sandboxed REPL? Scaffold the travel concierge:

```bash
npx glove-foundry init my-concierge --template travel-concierge
```

## Commands

| Command | What it does |
| --- | --- |
| `{{devCommand}}` | Discover agents, typecheck, generate routes, serve the runtime and inspector |
| `{{startCommand}}` | Run without file watching |
| `{{lintCommand}}` | Lint, including the Foundry file-routing rules |
| `{{typecheckCommand}}` | `tsc --noEmit` |

## Documentation

- [Building with Foundry](https://github.com/porkytheblack/glove/blob/main/packages/glove-foundry/docs/building-with-foundry.md)
- [Architecture](https://github.com/porkytheblack/glove/blob/main/packages/glove-foundry/docs/architecture.md)
- [The inspector](https://github.com/porkytheblack/glove/blob/main/packages/glove-foundry/docs/inspector.md)
