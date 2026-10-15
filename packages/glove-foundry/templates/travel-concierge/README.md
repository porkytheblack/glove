# {{projectName}}

A [Glove Foundry](https://github.com/porkytheblack/glove/tree/main/packages/glove-foundry) application. The example agent is a **travel concierge**: it searches flights, checks a calendar, remembers the traveller, replies over a chat transport, and wakes itself on a schedule.

It runs before you configure anything — there is a built-in demo model, so you get real runs and a real event trace with no API key.

## First run, step by step

Use Node.js 22.13+ (recommended); the CLI requires Node 22 or newer. Open a
terminal in this project's directory. If the setup wizard already installed
dependencies, you can skip the install command below.

```bash
cp .env.example .env.local     # optional: add OPENROUTER_API_KEY for real answers
{{installCommand}}
{{devCommand}}
```

Then open **http://127.0.0.1:4141** and press **Start a run**.

Choose **concierge** and send “Find a flight to Nairobi.” Open the resulting run
to follow its model calls, the `find_flights` tool call and the result. Send a
follow-up in the same conversation (the **Chat** page is easiest): the concierge
remembers the earlier turn. This is a deterministic demo: flights, calendar and
messaging are examples, not live provider integrations. Change
`agents/concierge/agent.ts`, save, and try another run to see the reload.

The run drawer creates a new instance by default. Pick **concierge-demo** instead
to use the seeded instance that has the calendar app and currency tool installed
and may reply over chat — see [Send it a chat message](#send-it-a-chat-message).

To get live model answers, put your own `OPENROUTER_API_KEY` in `.env.local`, then
restart the dev server. Never commit that file. The wizard does not collect keys.
Setting a model key does not connect a real calendar or messenger by itself.

## If something goes wrong

- Check `node --version` if you get an engine or SQLite error.
- Run `{{installCommand}}` again if installation was interrupted; project files are retained.
- If port 4141 is occupied, run the local `glove foundry dev --port 4142` command and open that address.
- If a run fails, open its event trace; a provider rate limit is different from a typecheck failure.
- State lives in `.data/` and survives restarts. Delete `.data/` to start fresh (for example after renaming an installed tool). Read **Going to production** before storing real user work.

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
  composition.ts                        composeAgent(...) — the installable catalogue
  flights.ts                            find_flights: always on, every instance
  tools/convert-currency.tool.ts        a shared tool an instance installs
  apps/calendar.app.ts                  an application an instance installs
  instances.ts                          the seeded concierge-demo instance + its binding
  transmissions/messaging.transmission.ts   Telegram/WhatsApp-shaped transport
  events/message-received.event.ts      an inbound event
  events/message-sent.event.ts          an outbound event
  predicates/mentions-trip.predicate.ts routing logic, kept out of the agent
  memory/traveller.memory.ts            ambient context, saved per instance
  schedules/trip-countdown.ts           recurring work
  layers/trip-context.layer.ts          direct access to the native Glove runtime
  subscribers/usage.subscriber.ts       observation without behaviour change
  workbench.ts                          the agent's VFS (persisted) + JavaScript REPL
  topology.ts                           accounts and routes (runtime data)

foundry.application.ts                  data adapter, accounts, routes, bindings
foundry.config.ts                       port, execution policy
lib/demo-model.ts                       keyless model — delete once you have a key
lib/file-store.ts                       durable conversation transcripts
lib/file-context.ts                     durable traveller memory
.data/                                  runtime state (git-ignored). delete to reset
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
| `connections/*.connection.ts` | A long-lived inbound worker | `defineConnection` |
| `actions/*.action.ts` | A playbook action | `definePlaybookAction` |

Assembly fields such as tools, memory, and schedules accept **a value or a function**. A resolver receives the current assembly context, including the message and instance, so one definition can adapt its capabilities to the request.

---

## Things you will want to do

### Add a tool

Two ways, depending on who should have it:

- **Every instance:** export a plain tool object and add it to the agent's `tools` field, like `find_flights` in `flights.ts`.
- **Instances that opt in:** create `agents/concierge/tools/weather.tool.ts`, default-export `defineSharedTool({...})`, add it to `composition.ts`, and install it on an instance (below), like `convert-currency`. Composing makes it available; installing mounts it.

### Add a second agent

Create `agents/<name>/agent.ts`. It is immediately routable, appears in the inspector, and is added to `FoundryRoutes` for the typed client.

### Give an instance a capability

Shared tools, applications and MCP servers stay inert until an instance installs them. `instances.ts` seeds `concierge-demo` with `convert-currency` and `calendar` installed. To install on another instance, use the API (the inspector shows installations but does not change them):

```bash
curl -X PUT http://127.0.0.1:4141/api/installations \
  -H 'content-type: application/json' \
  -d '{"agentId":"<instance-id>","kind":"application","id":"calendar","config":{"calendarId":"primary"}}'
```

### Send it a chat message

The calendar app owns the messaging transmission, and `concierge-demo` has both the
app installed and a **binding** (in `instances.ts`) that lets it reply on the
outbound route. Its `traveller-chat` playbook is written onto the instance during
its first run, so send it one message first (Chat page, or **Start a run** with
`concierge-demo` selected). Then deliver an inbound chat message:

```bash
curl -X POST http://127.0.0.1:4141/api/transmissions/traveller-inbound/fire \
  -H 'content-type: application/json' \
  -d '{"eventId":"evt-1","threadKey":"thread-42","raw":{"threadId":"thread-42","text":"Any flight to Nairobi in April?"}}'
```

The message mentions a flight, so the playbook matches and starts a run. The agent
searches flights and replies through the generated `glove_app_calendar__messaging_send`
tool; the demo transport prints `[telegram] -> thread-42: …` in the terminal running
`{{devCommand}}`. An instance without the binding cannot send: delivery fails with
"agent has no enabled bindings".

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

Use Foundry's scheduling tools for durable future work instead of `setTimeout`.
Schedules are data, not auto-discovered file routes. This example imports an
ordinary `schedules/trip-countdown.ts` module and returns its value from the agent's
lazy `schedules` field. You can also let the agent create schedules at runtime.
Foundry persists the activation so it can wake the instance later; inspect these
under **Automations**.

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

1. **Choose where state lives.** Each run executes in its own process, so everything the next message needs is on disk under `.data/`: runtime data (`FileFoundryDataAdapter`), transcripts (`lib/file-store.ts`), traveller memory (`lib/file-context.ts`) and the VFS (`foundryDataEnvironmentPersistence`). These are single-host. For several hosts, replace each with a database-backed adapter — persisting one does not persist the others. See [Persistence](https://glove.dterminal.net/foundry/docs/persistence).
2. **Delete `lib/demo-model.ts`** and the fallback in `agent.ts` once `OPENROUTER_API_KEY` is set.
3. **Own your credentials.** Foundry stores account *references*, never secrets. Keep tokens in your own adapter or secret manager.
4. **Run `{{startCommand}}`** rather than `dev` — no file watching, no restart-on-change.
5. **Keep the ESLint preset.** `glove-foundry/eslint` rejects patterns that break file routing, such as a hand-written `id` on a file-routed definition.
6. **Protect the control plane.** A non-loopback bind requires an application-owned `requestAuthorization` adapter. Put TLS and network/rate policy in front of it.

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
| `{{devCommand}}` | Discover agents, generate routes, serve the runtime and inspector |
| `{{startCommand}}` | Run without file watching |
| `{{lintCommand}}` | Lint, including the Foundry file-routing rules |
| `{{typecheckCommand}}` | `tsc --noEmit` |

## Documentation

- [Building with Foundry](https://github.com/porkytheblack/glove/blob/main/packages/glove-foundry/docs/building-with-foundry.md)
- [Architecture](https://github.com/porkytheblack/glove/blob/main/packages/glove-foundry/docs/architecture.md)
- [The inspector](https://github.com/porkytheblack/glove/blob/main/packages/glove-foundry/docs/inspector.md)
