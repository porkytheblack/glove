# {{projectName}}

A [Glove Foundry](https://github.com/porkytheblack/glove/tree/main/packages/glove-foundry) application. The example agent is a **travel concierge**: it searches flights, checks a calendar, remembers the traveller, replies over a chat transport, and wakes itself on a schedule.

It runs before you configure anything — there is a built-in demo model, so you get real runs and a real event trace with no API key.

```bash
cp .env.example .env.local     # optional: add OPENROUTER_API_KEY for real answers
{{installCommand}}
{{devCommand}}
```

Then open **http://127.0.0.1:4141** and press **Start a run**.

---

## The one idea to understand first

Foundry separates two things that most frameworks merge:

| | What it is | Where it lives | Changes when |
| --- | --- | --- | --- |
| **Definition** | Code. What an agent *can* assemble. | `agents/concierge/agent.ts` | You edit a file |
| **Instance** | Data. One persisted identity, with its own context, installed apps, and conversations. | Your data adapter | You call the API or use the inspector |

One definition serves many instances. Two travellers can run the same concierge with different calendars, budgets, and chat accounts — without a branch in your code.

**The filesystem is the registry.** `agents/concierge/agent.ts` *is* the agent `concierge`. There are no string ids to keep in sync, and renaming a file breaks the import at compile time rather than at 3am.

---

## What is in this project

```
agents/concierge/
  agent.ts                              the agent. start here
  composition.ts                        composeAgent(...) — what it is built from
  tools/find-flights.tool.ts            a shared tool
  apps/calendar.app.ts                  an application an instance installs
  transmissions/messaging.transmission.ts   Telegram/WhatsApp-shaped transport
  events/message-received.event.ts      an inbound event
  events/message-sent.event.ts          an outbound event
  predicates/mentions-trip.predicate.ts routing logic, kept out of the agent
  memory/traveller.memory.ts            ambient context across conversations
  schedules/trip-countdown.ts           recurring work
  layers/trip-context.layer.ts          direct access to the native Glove runtime
  subscribers/usage.subscriber.ts       observation without behaviour change
  workbench.ts                          the agent's VFS + JavaScript REPL
  topology.ts                           accounts and routes (runtime data)

foundry.application.ts                  data adapter, accounts, routes
foundry.config.ts                       port, execution policy
lib/demo-model.ts                       keyless model — delete once you have a key
src/client.ts                           a typed client for these agents
.foundry/routes.d.ts                    generated. do not edit
```

### Conventions

Any file matching these names under an agent folder is discovered automatically. Each one default-exports a single definition, and its **filename becomes its id**. Nested folders nest the id: `tools/calendar/today.tool.ts` is `calendar/today`.

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
| `connections/*.connection.ts` | A long-lived inbound worker | `defineConnection` |
| `actions/*.action.ts` | A playbook action | `definePlaybookAction` |

Every field of `defineAgent` accepts **a value or a function**. A function runs per request with the full context — message, history, instance, installations — which is how one definition adapts without branching inside a prompt.

---

## Things you will want to do

### Add a tool

Create `agents/concierge/tools/weather.tool.ts`, default-export `defineSharedTool({...})`, then add it to `composition.ts`. That is the whole loop — the dev server picks it up and regenerates types.

### Add a second agent

Create `agents/<name>/agent.ts`. It is immediately routable, appears in the inspector, and is added to `FoundryRoutes` for the typed client.

### Give an instance a capability

Applications and MCP servers stay inert until an instance installs one. From the inspector, open the instance and install `calendar`; or over the API:

```bash
curl -X PUT http://127.0.0.1:4141/api/installations \
  -H 'content-type: application/json' \
  -d '{"agentId":"<instance-id>","kind":"application","id":"calendar","config":{"calendarId":"primary"}}'
```

### Connect a real chat app

`transmissions/messaging.transmission.ts` has the shape; only `deliver` needs a real call.

```ts
function deliver(input: { threadId: string; text: string }, provider: string) {
  return Effect.tryPromise(async () => {
    const response = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: input.threadId, text: input.text }),
      },
    );
    const body = await response.json() as { result: { message_id: number } };
    return { externalMessageId: String(body.result.message_id) };
  });
}
```

For inbound, point the provider's webhook at your own HTTP handler and call `dispatchInbound` with the route id. Foundry stores only the safe metadata on the account — the token stays in your environment, behind `accessRef`.

### Schedule work

Agents never call `setTimeout`. Add a `schedules/*.ts` definition, or let the agent create one at runtime through Foundry's scheduling tools. Either way it becomes a persisted activation you can see under **Automations**.

### Call agents from your own code

```ts
import { createFoundryClient } from "glove-foundry/client";
import type { FoundryRoutes } from "../.foundry/routes.js";

const foundry = createFoundryClient<FoundryRoutes>({ baseUrl: "http://127.0.0.1:4141" });
const agent = await foundry.agent("concierge").create({ workspaceId: "demo" });
const conversation = await foundry.createConversation(agent.id);
const run = await foundry.send(agent.id, conversation.id, "Find me a flight to Nairobi");
console.log((await run.wait()).output);
```

`src/client.ts` is a runnable version of this.

---

## The inspector

`{{devCommand}}` serves a runtime inspector at **http://127.0.0.1:4141**.

| Page | Answers |
| --- | --- |
| Overview | Is the runtime healthy, what is running, what needs attention |
| Agents | Which definitions exist and which instances were provisioned |
| Runs | Every invocation, with status, duration, and source |
| Run detail | The phase spine and the full observable event trace |
| Automations | Schedules, sleeping runs, playbook listeners, inbound workers |
| Integrations | Transmissions, accounts, routes, and bindings |
| Workspaces | Shared entries, inbox, tasks, and non-secret environment values |

Filters live in the URL, so `/runs?status=failed` is a link you can send. Press `⌘K` to search, `j`/`k` to move through a list, `c` to start a run.

---

## Going to production

1. **Replace the data adapter.** `MemoryFoundryDataAdapter` in `foundry.application.ts` loses everything on restart. Implement `FoundryDataAdapter` against your database.
2. **Delete `lib/demo-model.ts`** and the fallback in `agent.ts` once `OPENROUTER_API_KEY` is set.
3. **Own your credentials.** Foundry stores account *references*, never secrets. Keep tokens in your own adapter or secret manager.
4. **Run `{{startCommand}}`** rather than `dev` — no file watching, no restart-on-change.
5. **Keep the ESLint preset.** `glove-foundry/eslint` rejects patterns that break file routing, such as a hand-written `id` on a file-routed definition.

---

## The Glove packages

| Package | What it gives you |
| --- | --- |
| [`glove-foundry`](https://www.npmjs.com/package/glove-foundry) | This framework: routing, runtime, inspector, client |
| [`glove-core`](https://www.npmjs.com/package/glove-core) | The agent runtime, model adapters, stores, tools |
| [`glove-js`](https://www.npmjs.com/package/glove-js) | The JavaScript REPL session used in `workbench.ts` |
| [`glove-python`](https://www.npmjs.com/package/glove-python) | A Python REPL, same shape |
| [`glove-lisp`](https://www.npmjs.com/package/glove-lisp) | A Lisp REPL, same shape |
| [`glove-working-environment`](https://www.npmjs.com/package/glove-working-environment) | The sandboxed VFS behind `defineWorkingEnvironment` |
| [`glove-memory`](https://www.npmjs.com/package/glove-memory) | Memory schemas and adapters |
| [`glove-mcp`](https://www.npmjs.com/package/glove-mcp) | MCP client and server support |
| [`glove-mesh`](https://www.npmjs.com/package/glove-mesh) | Multi-agent messaging |

Add an environment package when you need it — `glove-env-documents`, `glove-env-spreadsheets`, `glove-env-images`, `glove-env-slides`, `glove-env-render`, `glove-env-ocr`, `glove-env-media`, `glove-env-email`, `glove-env-zip`, `glove-env-motion` — and mount it in `workbench.ts`.

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
