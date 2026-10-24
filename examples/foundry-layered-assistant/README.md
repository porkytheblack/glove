# Layered assistant

A personal assistant built as layers of agents in Glove Foundry. One agent talks
to the person; the others do the work. Use it as a starting point for any
assistant that has to stay responsive while real work happens elsewhere.

```
            person (chat or call)
                    │
   ┌────────────────▼────────────────┐
   │ assistant · layer 1, interactor │  fast model, personal memory,
   │                                 │  text or voice, no heavy tools
   └───────┬─────────────────▲───────┘
  delegate │                 │ results and questions
   ┌───────▼───────┐  ┌──────┴────────┐
   │ coder         │  │ researcher    │  layer 2, workers: stronger model,
   │ sandbox       │  │ env:fetch     │  their own tools, no memory of the
   └───────────────┘  └───────────────┘  person, no way to reach them
```

Why split it this way:

| | Interactor (`assistant`) | Workers (`coder`, `researcher`) |
| --- | --- | --- |
| How fast it must reply | Now: a person is waiting | Minutes are fine |
| What context it keeps | The person: who they are, what they want | One task at a time, one conversation per delegation |
| How long it runs | One turn, or one call | As long as the task takes |
| What it can reach | Memory, the person, its delegates | Its sandbox or the web, and a question back to the interactor |

## Files

Each `agent.ts` only assembles. What the agent is made of lives beside it.

```
agents/
  assistant/
    agent.ts              assembly: model per surface, memory, delegates, run
    prompt.ts             how the interactor talks and when it delegates
    personal.memory.ts    what it knows about the person (glove-memory on SQLite)
    call.ts               the voice call: room, greeting
  coder/
    agent.ts  prompt.ts  workspace.ts      sandboxed files and scripts
  researcher/
    agent.ts  prompt.ts  workspace.ts      the same, plus env:fetch
lib/
  models.ts       one model choice per layer
  demo-model.ts   scripted models used when no API key is set
  file-store.ts   durable transcripts
  workspaces.ts   saves each delegation's workspace
scripts/verify.ts the whole exchange, offline
```

## Run it

```bash
pnpm install
pnpm --filter glove-foundry-layered-assistant verify   # offline, no keys
cp .env.example .env                                    # add ANTHROPIC_API_KEY
pnpm --filter glove-foundry-layered-assistant dev       # inspector at http://localhost:4142
```

In the inspector, create an `assistant` instance, open WebChat and ask for some
code. The assistant delegates to the coder and keeps talking. If the coder needs
to know something, its question comes back to the assistant, which answers from
memory or asks you. The result arrives as a new turn in the same chat.

## Call it

The same assistant takes calls. Start one by sending a message whose payload
names a port and a one-time token; the page then connects to the room:

```ts
const foundry = createFoundryClient({ baseUrl: "http://127.0.0.1:4142" });
await foundry.createConversation("maya", { id: "maya-call" });
await foundry.send("maya", "maya-call", "call", { payload: { call: { port: 4770, token } } });
// browser: new WebSocket(`ws://127.0.0.1:4770/call?token=${token}`)
// binary PCM16 at 16 kHz both ways, plus JSON captions and state
```

Set `OPENAI_API_KEY` for the speech model. While the call is live, results and
questions from the workers are spoken at the next pause. A result that lands
after you hang up starts an ordinary text turn in that conversation, so it is
waiting in the chat.

## Deploy

Copy the folder into its own repository, swap the `workspace:*` versions for
published ones, and run `kuiper deploy`. Point `LAYERED_DATA_DIR` at `/data` so
transcripts, memory and workspaces sit on the persistent disk, and add
`ANTHROPIC_API_KEY` as a secret. The call room listens on its own port, so put
it behind your own proxy if callers connect from outside.
