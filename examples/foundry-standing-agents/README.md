# Standing agents

Agents that keep working on a responsibility between conversations, built with
Glove Foundry. It follows the shape of OpenAI's Dots. A dot has a job, the
sources it reads, what deserves your attention and what it must not do yet. It
does research on its own time with tools that can only read. Every action it
takes is checked against your rules first. You talk to the same dot in the app
and in Slack, and for heavy jobs it messages a builder that has a computer.

This is an independent example. It is not affiliated with or endorsed by OpenAI.

```
   you, in the app                     you, in Slack (DM, or @mention in a thread)
        │                                     │  Events API → scripts/slack-events.ts
        │                                     ▼  → transmission "slack-messages"
   ┌────▼─────────────────────────────────────────────┐
   │ dot · one instance per responsibility             │  context: job, sources,
   │   "app" conversation      "slack" conversation    │  attention, mustNot,
   │          └──── one memory for both ────┘          │  rules, routing
   └────┬──────────────────┬──────────────────┬───────┘
        │ every 2h         │ acting tools     │ mesh message
   ┌────▼───────────┐ ┌────▼─────────────┐ ┌──▼──────────────────┐
   │ research run   │ │ auto-review      │ │ builder             │
   │ read_channel   │ │ act · on-request │ │ its own computer,   │
   │ read_email     │ │ ask → approval   │ │ env:fetch           │
   │ keep_note      │ │ hand-off         │ │ result goes back to │
   │ suggest        │ │ change_password: │ │ the dot that asked  │
   │ nothing acts   │ │ always yours     │ └─────────────────────┘
   └────────────────┘ └──────────────────┘
```

| Dots | Here |
| --- | --- |
| A dot with a responsibility | One `dot` definition. Each dot is an instance whose context holds `responsibility` (`job`, `sources`, `attention`, `mustNot`), `rules` and `routing` (`lib/dot.ts`) |
| Keeps working between conversations | The `research` schedule, every 2 hours (`agents/dot/research.ts`) |
| Research tools only read | On runs the dot starts itself (schedule, wake-up, spawn), the `tools` resolver returns only `read_channel`, `read_email`, `read_notes`, `keep_note` and `suggest`. The Slack app mounts no post tool and the mesh is not mounted (`mount`). The acting tools are not there at all |
| Private notes | `keep_note` and `read_notes`, one file per instance |
| Brings a suggestion or question | `suggest`, at most once per run. The reply lands in the app conversation |
| Auto-review before actions | `reviewed()` in `lib/auto-review.ts` wraps every acting tool before it is mounted. There is no way to mount one without it |
| Custom Rules, four levels | `act` runs. `on-request` runs only when the person started the run. `ask` sets `requiresPermission`, so Foundry holds an approval. `hand-off` never runs and tells the dot what to hand over |
| Rules can't override safety | `change_password` is always a hand-off, whatever `rules` says |
| Checks against your instructions | `send_email` or `reply_to_customer` to an address that never wrote in asks, even on `act` (the function form of `requiresPermission`) |
| The same dot in the app and Slack | Two conversations on one instance, keyed `app` and `slack`. Slack messages join with `conversationKey: "slack"` |
| Only answers its owner in Slack | The `from-owner` predicate on `slackUserId`, in the playbook |
| Each channel has its history; learning carries over | One transcript per conversation (`lib/file-store.ts`), one `defineMemory` namespace per instance (`lib/memory.ts`) |
| Updates routed by channel | `routing`. With decisions → Slack, a hand-off reaches the person as a Slack DM |
| Hands heavy work to a worker | Each person has one builder, an instance in the same workspace (`builderFor` in `lib/dot.ts`). The dot finds it with `glove_mesh_list_agents` and sends the job with `glove_mesh_send_message`; the builder's final reply comes back to the conversation that asked. A `peers` rule lets dots reach only the builder, and the builder can only answer. The builder has a working environment with `env:fetch` |

## Files

Each `agent.ts` only assembles. What the dot is made of lives beside it, and
the review, the actions and the sources live in `lib/`.

```
agents/
  dot/
    agent.ts                     assembly: model, memory, tools, schedule, playbook, mesh, account session
    prompt.ts                    the prompt, built from the responsibility and rules
    tools.ts                     read-only tools on the dot's own time; reviewed actions otherwise
    research.ts                  the research schedule; which runs may act
    person.memory.ts             one memory for every channel
    apps/slack.app.ts            post_to_slack, and the inbound messages
    transmissions/slack-messages.transmission.ts   Slack's event_callback → a message event
    predicates/from-owner.predicate.ts             only the owner's messages
    playbook.ts  topology.ts  events/  actions/
  builder/  agent.ts prompt.ts workspace.ts        the worker each person has, with env:fetch
lib/
  dot.ts           the dot's shape, dotFor(), builderFor(), channels, the instance read fresh
  auto-review.ts   reviewed(): safety, rules, the recipient check
  actions.ts       reply_to_customer, send_email, open_draft_pr, merge_pr, change_password
  sources.ts       read_channel, read_email, notes, suggest, known contacts
  slack-api.ts     chat.postMessage as the bot
  models.ts  demo-model.ts  demo-scripts.ts       real models with a key, scripted without
  memory.ts  file-store.ts  computers.ts  paths.ts  authorization.ts
fixtures/          the #feedback channel and the support inbox the demo reads
scripts/
  verify.ts        the whole example, offline
  onboard.ts       create a dot on a running Foundry
  slack-events.ts  Slack's challenge and signature, then forward to Foundry
```

## Run it

```bash
pnpm install
pnpm --filter glove-foundry-standing-agents verify   # offline, no keys
cp .env.example .env                                 # add ANTHROPIC_API_KEY
pnpm --filter glove-foundry-standing-agents dev      # inspector at http://localhost:4145
pnpm tsx scripts/onboard.ts sam "Sam" U0123456789
```

`verify` runs seven steps on the real runtime with scripted models:

1. Sam creates a feedback dot. Its research schedule (every 2 hours) joins the app conversation.
2. A research run reads #feedback and the support inbox, keeps a note and suggests one thing. The
   scripted model also tries `reply_to_customer`, and the tool is not there. No acting tool is mounted.
3. Sam asks for a reply to a customer. It waits for approval, then sends.
4. "Merge the fix PR" is handed off: no approval, no merge, and a Slack DM tells Sam what to do.
   `change_password` is handed off too, even after its rule is set to `act`.
5. "Open a draft PR" runs with no approval because Sam asked. On a run Sam didn't start, it doesn't.
6. Sam DMs the bot in Slack. The message joins the dot's Slack conversation, and the answer uses
   what Sam told the dot in the app. A stranger's mention starts nothing.
7. Sam asks for a weekly report. The dot messages his builder on the mesh, and the builder's reply comes
   back to the app.

Without `SLACK_BOT_TOKEN`, posts to Slack are written to `.data/slack-outbox.jsonl`.
Actions that really ran are listed in `.data/actions.jsonl`.

## Connect Slack

1. Create a Slack app. Give the bot the `chat:write`, `im:history` and
   `app_mentions:read` scopes, turn on the Messages tab in App Home, and install
   it in your workspace. Set `SLACK_BOT_TOKEN`, `SLACK_TEAM_ID`, `SLACK_APP_ID`
   and `SLACK_BOT_USER_ID`.
2. Run `pnpm slack-events` where Slack can reach it, with `SLACK_SIGNING_SECRET`,
   `FOUNDRY_URL` and `FOUNDRY_TOKEN`.
3. Under Event Subscriptions, set its URL as the request URL and subscribe the
   bot to `message.im` and `app_mention`.
4. Create each person's dot with their Slack user id (`scripts/onboard.ts`).

The forwarder answers Slack's `url_verification` challenge. It checks
`x-slack-signature` on every request (`v0=` HMAC-SHA256 of
`v0:{timestamp}:{body}` with the signing secret) and rejects timestamps more
than five minutes old. It skips the bot's own posts, edits and plain channel
messages, and sends each DM and mention to
`POST /api/transmissions/slack-messages/fire` with `conversationKey: "slack"`.
Slack's `event_id` is the event id, so a retried delivery runs once. The
playbook on each dot matches only its owner's user id, so one Slack app serves
everyone.

To try the forwarder without Slack, sign a request yourself:

```bash
body='{"type":"url_verification","challenge":"hello"}'
ts=$(date +%s)
sig="v0=$(printf 'v0:%s:%s' "$ts" "$body" | openssl dgst -sha256 -hmac "$SLACK_SIGNING_SECRET" | sed 's/^.* //')"
curl -s localhost:4146 -H "x-slack-request-timestamp: $ts" -H "x-slack-signature: $sig" -d "$body"   # hello
```

## Deploy on Kuiper

Copy the folder into its own repository and swap the `workspace:*` versions for
published ones. Then:

```bash
kuiper login
kuiper projects create dots && kuiper use dots
kuiper units create dots

kuiper providers add anthropic --key -            # once per organisation
kuiper secrets set SLACK_BOT_TOKEN=-
kuiper env set -u dots DOTS_DATA_DIR=/data \
  'ANTHROPIC_API_KEY=${{models.API_KEY}}' \
  'ANTHROPIC_BASE_URL=${{models.ANTHROPIC_BASE_URL}}' \
  'SLACK_BOT_TOKEN=${{secrets.SLACK_BOT_TOKEN}}' \
  SLACK_TEAM_ID=… SLACK_APP_ID=… SLACK_BOT_USER_ID=…

kuiper deploy --source . -u dots --wait
kuiper dashboard -u dots --enable                 # inspector login
kuiper logs -u dots -f
```

Model calls go through Kuiper's model gateway, so the Anthropic key stays with
the organisation and every call is counted. Transcripts, memory, notes and the
builder's computer sit on the `/data` disk.

The Slack forwarder runs as a second unit from the same source. It is the only
public way in for Slack, and it reaches Foundry over the private address. Its
public URL is the Slack request URL:

```bash
kuiper units create slack-events
kuiper settings -u slack-events --start-command "pnpm slack-events" --port 4146
kuiper secrets set SLACK_SIGNING_SECRET=-
kuiper secrets set FOUNDRY_TOKEN=-
kuiper env set -u slack-events 'SLACK_SIGNING_SECRET=${{secrets.SLACK_SIGNING_SECRET}}' \
  'FOUNDRY_TOKEN=${{secrets.FOUNDRY_TOKEN}}' 'FOUNDRY_URL=${{dots.INTERNAL_URL}}'
kuiper env set -u dots 'FOUNDRY_TOKEN=${{secrets.FOUNDRY_TOKEN}}'
kuiper deploy --source . -u slack-events --wait
```

For a builder that runs real code, swap `lib/computers.ts` for a Kuiper sandbox
(`kuiper.sandboxes.create({ image: "kuiper/coding" })` from `@kuiper-sh/sdk`).
For email, replace the stand-ins in `lib/actions.ts` and `lib/sources.ts` with
an inbox and `inboxTools` from `@kuiper-sh/inbox/glove`.

## Notes

- A recurring schedule fires with the instance as it was when the schedule was
  armed (porkytheblack/glove#199). The dot's resolvers read the
  instance fresh (`storedInstance` in `lib/dot.ts`), so a change to the rules
  or the responsibility reaches the next research run.
- Foundry's own tools stay mounted on research runs. They act on the dot itself
  (its schedules, workspace and tasks), not on the outside world.
  `glove_foundry_transmit` only reaches outbound routes a playbook declares, and
  the dot declares none. Work the dot spawns is read-only too.
