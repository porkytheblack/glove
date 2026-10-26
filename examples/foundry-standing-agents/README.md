# Dots

Always-on agents that work on your behalf, built with Glove Foundry. It
follows the shape of OpenAI's dots, which OpenAI launched at DevDay on 29
September 2026, running on GPT-6 Astra. For now each person gets one dot, with
a name and a handle like @pip-dot; more dots and teams of dots are planned.
Here too you start with your own dot and give it a name, and its handle
comes from that name (`handleOf` in `lib/dot.ts`). It holds the
responsibilities you hand it and researches them in the background with tools
that can only read. Before it acts, an auto-review checks the action against
your Custom Rules and built-in safety. You reach the same dot in the app, in
Slack and on a call. It works in the apps you connect (here the support
mailbox, in Gmail). It has its own computer, and it starts coding jobs on a
builder.

This is an independent example. It is not affiliated with or endorsed by OpenAI.

```
   you: the app · Slack (DM or @mention) · a call
        │                     Slack Events API → scripts/slack-events.ts → transmission
   ┌────▼──────────────────────────────────────────────────┐
   │ Pip · Sam's dot · one instance                         │  data: name, responsibilities,
   │   "app"   "slack"   a call   — one memory, notes       │  Custom Rules, routing
   │   its own computer (files, web)                        │
   └────┬──────────────────┬───────────────────┬───────────┘
        │ every 2h         │ acting tools      │ mesh message
   ┌────▼───────────┐ ┌────▼──────────────┐ ┌──▼───────────────────┐
   │ research run   │ │ auto-review       │ │ Builder (Sam's)      │
   │ read_channel   │ │ Custom Rules, on  │ │ coding jobs on its   │
   │ gmail.* in code│ │ actions and on    │ │ own computer; reply  │
   │ keep_note      │ │ Gmail's send      │ │ goes back to Pip     │
   │ suggest        │ │ change_password:  │ └──────────────────────┘
   │                │ │ always yours      │
   │ nothing acts,  │ └───────────────────┘
   │ no computer    │
   └────────────────┘
```

## A dot is data

There is one `dot` definition (`agents/dot/agent.ts`). It says what a dot can
be. Each dot is an instance, and what makes it yours is its data
(`lib/dot.ts`): the name you gave it, its responsibilities, your Custom Rules
and where updates go. Sam's dot, Pip, and his builder are seeded in
`foundry.application.ts` with `defineAgentInstance`, so `pnpm dev` opens with
them in place; everyone else's dot is created at runtime (`scripts/onboard.ts`).
Renaming a dot, giving it a new responsibility or changing a rule is a write
(`configureAgent`), not a deploy.

## Connected apps

Gmail is a Foundry app installed on the dot with the mailbox it works from:
Sam connected the support inbox. It works as in the bot crew and partner
examples, with the dot's rules on top:

- **Reads come from Google's Gmail MCP server**, opened with the installation's
  account, and are functions in code: research reads the mailbox with
  `gmail.search_threads` in one program.
- **On read-only runs, only the reads mount.** The app's tool policy hides
  everything else when the request is research, a wake-up, new mail, or work the
  dot started that isn't a follow-up. On a paused dot, `configureDot` removes the
  rest.
- **Sending is the Gmail transmission's outbound side**, delivered by Foundry
  inside the account session. The dot wraps that send in its auto-review
  (`reviewSends` in `agents/dot/tools.ts`) under the rule `send_email`, and an
  address that never wrote in to the mailbox asks whatever the rule says.
- **New mail starts a read-only run.** The `gmail-watch` connection passes each
  message in; mail comes from anyone, so the dot reads it and keeps notes but
  cannot act on it.

A specialist dot connects its own mailbox the same way, so it acts under its
own credentials. Accounts and tokens are yours (`lib/accounts.ts`); the Slack
bot user stays the app's own account.

| Dots | Here |
| --- | --- |
| Your primary dot, with a name you give it | `primaryDot(ownerId, { name, … })`: an instance in the person's workspace, named by them |
| Ongoing responsibilities, several at once | `responsibilities: [{ job, sources, attention, mustNot }]` on the instance. One research run covers them all |
| Proactive research with read-only tools | The `research` schedule, every 2 hours. On read-only runs (research, wake-ups, new mail, work the dot started that isn't a follow-up, and every run of a paused dot), the `tools` resolver returns only `read_channel`, `read_notes`, `keep_note` and `suggest`, and the Gmail app mounts only its reads. The Slack post tool, Gmail's send, the mesh (`mount`), the computer (`workingEnvironment`) and Foundry's tools that start runs are not there at all |
| Triggers: follow-ups it schedules, schedules with a time zone, event triggers | `glove_foundry_schedule` (`every`, `at`, or `cron` with a time zone). On a run that may act, `followUps()` in `agents/dot/research.ts` stamps what the dot schedules or spawns with `followUp: true`, so those runs act under the Custom Rules. New mail is an event trigger, and here it only reads |
| Works in your apps (4,000+ through plugins) | Foundry apps installed with your accounts: Gmail here, through Google's MCP server for reads, the Gmail transmission for sending and a connection for new mail |
| Notes to itself | `keep_note` and `read_notes`, one file per dot |
| Memory: the chat, ChatGPT memory and the dot's own notes | The conversation, the person's account memory (one namespace per workspace, which the dot reads but can't change) and the dot's own memory (one namespace per instance, shared by every channel, `glove_context_set`), layered in `lib/memory.ts`; and its notes file |
| Custom Rules: act without asking, act when asked, ask first, or hand off to you | `rules: { action: "allow" \| "when_asked" \| "ask" \| "block" }`. `ask` sets `requiresPermission`, so Foundry holds an approval. `when_asked` acts without asking on a run the person started and asks on any other. `block` never runs; the dot hands the action to you. No rule → ask |
| Built-in safety: password changes and money transfers are always yours; permanent deletion, software installs and saved-card purchases need approval | `ALWAYS_YOURS` (`change_password`, `transfer_money`) is handed to you and `ALWAYS_ASKS` (`delete_permanently`, `install_software`, `buy_with_saved_card`) never goes below ask first, whatever `rules` says. Of these, only `change_password` exists here; the sets apply to any action registered under those names |
| Auto-review checks sensitive actions (such as sending email) before they run; you can't switch it off | `reviewed()` in `lib/auto-review.ts` wraps every acting tool, and Gmail's send, so the dot never sees an unreviewed one. Email to an address that never wrote in asks, even on `allow` (the function form of `requiresPermission`) |
| Its own cloud computer and browser | `workingEnvironment` with files and the public web (`env:fetch`), saved per dot by Foundry's data adapter (`foundryDataEnvironmentPersistence({ scope: "agent" })`) |
| Coordinates: splits work across background agents, hands coding to Codex and long jobs to ChatGPT Work, checks the results | `glove_foundry_spawn` starts runs of the dot, which act under the same rules. Coding goes to the person's `Builder` over the mesh (`glove_mesh_send_message`); its reply comes back to the conversation that asked, and the dot checks it before it reports |
| ChatGPT, Slack and Teams, with context in every channel | Conversations on one instance, keyed `app` and `slack`. Slack messages join with `conversationKey: "slack"`. Teams isn't built here; it would be a second transmission and forwarder like Slack's |
| Hop on a call | `voiceCall` over the same assembled dot (`agents/dot/call.ts`) |
| Slack: DMs and channel mentions | The forwarder passes only DMs and mentions, so, as with dots, adding the bot to a channel doesn't make it watch the channel. Answering only its owner is this example's choice: the `from-owner` predicate on `slackUserId`, in the playbook |
| Notification rules on schedules | `routing`, this example's choice, set per dot rather than per schedule: progress to the app, decisions to Slack, so a hand-off reaches the person as a Slack DM |
| Activity View: progress, files and pending requests; redirect or pause | The inspector's runs, mesh threads (`runtime.listThreads()`) and pending approvals; steering redirects a run. `paused: true` on the dot (`configureAgent`) pauses it |
| Safety monitoring can pause a dot; stopping doesn't undo what it already did | `monitored()` in `lib/monitor.ts`, around every run except calls: after three hand-offs or denials in a row it sets `paused: true`, and every run of a paused dot only reads until you set it back. As with dots, pausing doesn't undo actions already taken |
| Saved passwords used without the model seeing them | Account sessions: the Slack token and the mailbox's tokens are read only by `accountSessions`, never by the dot |
| Specialist dots (enterprise preview), provisioned by IT with their own identity, credentials and system access | `specialistFor(org, { name, responsibilities, rules, account })`: the same definition, an instance in the organisation's workspace with its own name, its own Slack account and its own connected mailbox |

## Files

Each `agent.ts` only assembles. What a dot is made of lives beside it, and
the review, the actions and the sources live in `lib/`.

```
agents/
  dot/
    agent.ts                     what a dot can be: model, memory, tools, schedule, playbook, computer, mesh, call
    prompt.ts                    the prompt, built from the dot's data
    tools.ts                     read-only tools on read-only runs; reviewed actions and Gmail's send otherwise
    research.ts                  the research schedule; which runs may act; follow-ups
    workspace.ts                 the dot's own computer
    call.ts                      a call with your dot
    person.memory.ts             the person's account memory and the dot's own, in every channel
    apps/gmail.app.ts            the mailbox: MCP reads, the send, the watch; reads only on the dot's own time
    apps/slack.app.ts            post_to_slack, and the inbound messages
    transmissions/gmail.transmission.ts  connections/gmail-watch.connection.ts   new mail in, email out
    transmissions/slack-messages.transmission.ts   Slack's event_callback → a message event
    predicates/from-owner.predicate.ts             only the owner's messages
    playbook.ts                  Slack messages from the owner; new mail
    topology.ts  events/  actions/
  builder/  agent.ts prompt.ts workspace.ts        where a person's dot starts coding jobs
lib/
  dot.ts           a dot as data: primaryDot(), specialistFor(), builderFor(), Sam, channels
  auto-review.ts   reviewed(): built-in safety, Custom Rules, the recipient check
  monitor.ts       pauses the dot after hand-offs and denials in a row
  actions.ts       open_draft_pr, merge_pr, change_password
  sources.ts       read_channel, notes, suggest, known contacts (read through the Gmail app)
  accounts.ts      your account store: accounts, tokens, the directory, accountSessions
  connect.ts       connecting a mailbox: account, routes, installation, binding
  oauth.ts  google.ts  mcp-servers.ts  tool-policy.ts  ledger.ts
  slack-api.ts     chat.postMessage as the bot
  models.ts  demo-model.ts  demo-scripts.ts       real models with a key, scripted without
  memory.ts        account memory under the dot's own
  file-store.ts  paths.ts  authorization.ts
foundry.application.ts   Sam's dot, builder and app conversation, seeded with defineAgentInstance
demo/              a local Gmail MCP server over the sample support inbox
fixtures/          the #feedback channel and the support inbox the demo reads
scripts/
  verify.ts        the whole example, offline
  onboard.ts       give a person their dot on a running Foundry
  connect.ts       connect their mailbox through Google's sign-in
  slack-events.ts  Slack's challenge and signature, then forward to Foundry
```

## Run it

```bash
pnpm install
pnpm --filter glove-foundry-standing-agents verify   # offline, no keys
cp .env.example .env                                 # add ANTHROPIC_API_KEY
pnpm --filter glove-foundry-standing-agents dev      # inspector at http://localhost:4145
pnpm onboard ada "Ada" Juniper U0123456789
pnpm connect ada gmail                               # needs GOOGLE_CLIENT_ID and friends
```

`verify` runs eleven steps on the real runtime with scripted models and the
support inbox as a sample account:

1. Sam's dot, Pip, his builder and their app conversation are seeded data, with the support
   mailbox connected and watched. Pip's research schedule (every 2 hours) joins the app conversation.
2. A research run reads #feedback and the mailbox (in code, through the Gmail app), keeps a note
   and suggests one thing. The scripted model also tries Gmail's send, and the tool is not there.
   No acting tool, no mesh, no computer and no tool that starts a run is mounted.
3. "Ask": a reply to a customer waits for approval, then goes from the support mailbox in her thread.
4. "Block": "Merge the fix PR" is not run; a Slack DM tells Sam what to do. `change_password` is
   his too, even after its rule is set to `allow`.
5. "Allow": "Open a draft PR" runs with no approval. Email to an address that never wrote in
   still asks.
6. Sam DMs Pip in Slack. The message joins Pip's Slack conversation, and the answer uses what
   Sam told Pip in the app. A stranger's mention starts nothing.
7. New mail from a customer starts a read-only run: Pip notes it and sends nothing.
8. Pip saves a file on its own computer.
9. Sam asks for a weekly report. Pip starts it on his builder over the mesh, and the builder's
   reply comes back to the app.
10. Sam sets a follow-up every Monday at 9:00 New York time; the schedule is stamped as a
    follow-up. With `open_draft_pr` on "act when asked", a draft PR opens with no approval when
    Sam asks, and on the follow-up's run it asks first. Sam denies it.
11. That denial and two hand-offs in a row: the monitor pauses Pip. Asked for a draft PR, the
    tool isn't there. Sam resumes it with `configureAgent`.

Without `SLACK_BOT_TOKEN`, posts to Slack are written to `.data/slack-outbox.jsonl`.
Actions that really ran are listed in `.data/actions.jsonl`, and sample emails in `.data/ledger.jsonl`.
The monitor keeps its count in `.data/monitor.json`.

## Where it differs

- Dots run their own auto-review, which you can't switch off; here it is code over rules and
  recipients. You could put a [classifier](https://glove.dterminal.net/docs/classifier) or a second
  model call inside `reviewed()`.
- The computer is a Glove working environment (files, scripts, the public web) until you swap in
  a Kuiper sandbox and browser. You can't connect your own laptop here.
- Here the dot's notes are a file you can read and edit (`.data/notes`), and its memory can be
  changed entry by entry. A dot's notes can't be viewed or edited one by one, and deleting the
  dot is the only reset.
- Dots connect to thousands of apps through plugins. Here the sources and actions are stand-ins
  in `lib/`; add yours as apps, shared tools or MCP servers.

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

Teams isn't built here; it would be a second transmission and forwarder like
Slack's, with a `teams` conversation on the same instance.

The forwarder answers Slack's `url_verification` challenge. It checks
`x-slack-signature` on every request (`v0=` HMAC-SHA256 of
`v0:{timestamp}:{body}` with the signing secret) and rejects timestamps more
than five minutes old. It skips the bot's own posts, edits and plain channel
messages, and sends each DM and mention to
`POST /api/transmissions/slack-messages/fire` with `conversationKey: "slack"`.
As with dots, adding the bot to a channel doesn't make it watch the channel.
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
kuiper secrets set SLACK_BOT_TOKEN=- FOUNDRY_TOKEN=-
kuiper env set -u dots DOTS_DATA_DIR=/data \
  'FOUNDRY_TOKEN=${{secrets.FOUNDRY_TOKEN}}' \
  'ANTHROPIC_API_KEY=${{models.API_KEY}}' \
  'ANTHROPIC_BASE_URL=${{models.ANTHROPIC_BASE_URL}}' \
  'SLACK_BOT_TOKEN=${{secrets.SLACK_BOT_TOKEN}}' \
  SLACK_TEAM_ID=… SLACK_APP_ID=… SLACK_BOT_USER_ID=…

kuiper deploy --source . -u dots --wait
kuiper dashboard -u dots --enable                 # inspector login
kuiper logs -u dots -f
```

`FOUNDRY_TOKEN` goes in before the first deploy: Foundry refuses to listen on a
public address without an authorizer, and `lib/authorization.ts` makes one from
that token (or from the inspector login `kuiper dashboard --enable` sets).

Model calls go through Kuiper's model gateway, so the Anthropic key stays with
the organisation and every call is counted. Dots, transcripts, memory, notes
and both computers sit on the `/data` disk.

Calls need two things the deploy above doesn't give:

- **A public port for the call room.** The room listens on the port in the
  call request, and the unit Kuiper infers opens only 4141. Run
  `kuiper manifest init --foundry`, add `{ "name": "call", "port": 4160,
  "public": true }` to `ports` in the `kuiper.json` it writes, commit it, and
  start calls on 4160, one at a time.
- **`OPENAI_API_KEY` as a secret.** The speech-to-speech session talks to
  OpenAI's realtime API, which Kuiper's model gateway doesn't serve:
  `kuiper secrets set OPENAI_API_KEY=-`, then
  `'OPENAI_API_KEY=${{secrets.OPENAI_API_KEY}}'`.

The Slack forwarder runs as a second unit from the same source. It is the only
public way in for Slack, and it reaches Foundry over the private address. Its
public URL is the Slack request URL:

```bash
kuiper units create slack-events
kuiper settings -u slack-events --start-command "pnpm slack-events" --port 4146
kuiper secrets set SLACK_SIGNING_SECRET=-
kuiper env set -u slack-events 'SLACK_SIGNING_SECRET=${{secrets.SLACK_SIGNING_SECRET}}' \
  'FOUNDRY_TOKEN=${{secrets.FOUNDRY_TOKEN}}' 'FOUNDRY_URL=${{dots.INTERNAL_URL}}'
kuiper deploy --source . -u slack-events --wait
```

For a computer with a real browser, mount a Kuiper sandbox and browser per dot
with `kuiperSandbox` and `kuiperBrowser` from `glove-execution/kuiper`, in place
of the working environments in `agents/dot/workspace.ts` and
`agents/builder/workspace.ts`.
Connect the real mailbox with the `GOOGLE_*` and `GMAIL_PUBSUB_*` variables in
`.env.example` and `pnpm connect`; new mail needs nothing public, since the
watch pulls its subscription from inside the unit.

## Notes

- A recurring schedule fires with the instance as it was when the schedule was
  armed (porkytheblack/glove#199). The dot's resolvers read the
  instance fresh (`storedInstance` in `lib/dot.ts`), so a change to the rules,
  the responsibilities or `paused` reaches the next scheduled run. Slack's post,
  the mailbox's tool filter and the mesh decide by who started the run, so on a
  paused dot `configureDot` removes them.
- Foundry's own tools stay mounted on research runs, except those that start
  runs (`glove_foundry_schedule`, `glove_foundry_spawn`,
  `glove_foundry_background`), and schedules can only be listed. The rest act on
  the dot itself (its workspace and tasks), not on the outside world.
  `glove_foundry_transmit` only reaches outbound routes a playbook declares, and
  the dot's playbooks declare none, so a binding alone cannot make it send.
- A wake-up from `glove_foundry_sleep` carries no payload, so it only reads.
  For a follow-up that acts, the dot schedules one.

## Sources

- [Introducing dots](https://openai.com/index/introducing-dots/), OpenAI
- [Dots privacy, security and safety FAQs](https://help.openai.com/en/articles/20001529), OpenAI Help Center
- [Push notifications](https://developers.google.com/workspace/gmail/api/guides/push) and [the Gmail MCP server](https://developers.google.com/workspace/gmail/api/reference/mcp), Google
- [OpenAI Dots hands-on review: my first day with Herman](https://www.theneuron.ai/explainer-articles/openai-dots-hands-on-review-herman/), The Neuron
- [A deep dive into OpenAI dots](https://flaviocopes.com/openai-dots/), Flavio Copes
