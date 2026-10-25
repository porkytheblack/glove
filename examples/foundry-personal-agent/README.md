# Personal agent

A personal agent that does the work for one person, built with Glove Foundry.
It follows the shape of Meta's Muse:

- the person talks to it in an app or on WhatsApp, like messaging someone;
- it works across the apps they connect, at the access they choose;
- it has a computer of its own for the web;
- a separate Sentinel decides what may leave that computer;
- it uses their logins without seeing them, and pays with one-time cards;
- it keeps going after they close the app;
- it keeps a log of everything it did and plans to do.

This is an independent example. It is not affiliated with or endorsed by Meta,
and it is not how Muse is built.

```
   the app ─────┐                  WhatsApp ──► scripts/whatsapp-webhook.ts ──► whatsapp-in
                ▼                                                                    │
   ┌───────────────────────────────── Muse · one per person ─────────────────────────▼──┐
   │ conversations: app, whatsapp · one memory                                          │
   │ gmail.search_threads(…), calendar.list_events(…) in code · at the access she chose │
   │ buy (one-time card) · Gmail send · WhatsApp answer  ── each asks or is hers only   │
   └────────────┬───────────────────────────────────────────────────────────┬──────────┘
                │ scripts on its own computer                                │ every tool call
                ▼                                                            ▼
   env:fetch ── authorize ──► Sentinel: allow · block · ask her       the log (subscriber)
        │       credential: "bistro-luna" ◄── her vault (Muse can't read it)
        ▼
     the web
```

## One Muse, two places

Each person has one Muse instance (`lib/people.ts`). It has two
conversations, `app` and `whatsapp`, and one memory, so what Rosa says on
WhatsApp is known in the app. WhatsApp is a Foundry app with an inbound and an
outbound transmission:

- Every message to Muse's number arrives on one shared route.
- Each person's playbook only takes messages from their own number (the
  `from-person` predicate), so a stranger's message wakes nothing.
- Answers go out on a route made for that person, whose config fixes the
  recipient. Muse can answer its person on WhatsApp but cannot message anyone
  else there.
- Meta needs a webhook with a verify-token handshake and signed deliveries.
  `scripts/whatsapp-webhook.ts` does both and forwards each text message to
  Foundry.

## Apps at the access she chooses

Gmail and Google Calendar are Foundry apps installed with Rosa's accounts, as
in the other rebuilds: Google's MCP servers for reads, run as functions in
code; the Gmail transmission for sending; a Gmail watch for new mail. What is
new is the access she chooses for each app, kept as the installation's
config:

- **read**: the app's tool policy hides every tool that changes something, and
  `configure` removes Gmail's send tool, so Muse cannot even try. The send
  binding is off, so Foundry would refuse the delivery anyway.
- **act**: drafting runs; sending, and creating or moving events, ask her
  first unless she always allows them.

`setAccess` changes it and `disconnect` takes an app away (`lib/connect.ts`).
Both are writes, not deploys. `pnpm connect <person> gmail read|act` asks
Google only for the scopes that access needs.

## Its own computer, and the Sentinel

Muse's computer is a Glove working environment saved per instance
(`agents/muse/vm.ts`). It has files and scripts that last, and the web through
`env:fetch`. Two things guard it.

**The Sentinel** (`agents/muse/sentinel.ts`). `env:fetch` calls its
`authorize` for every request and every redirect, outside the sandbox, before
anything leaves.

- It is kept apart from Muse. It never sees Muse's conversation, its reasoning
  or the pages it read, so a page that tells Muse what to do cannot talk the
  Sentinel round.
- It sees only the request, what the person asked for in this run, and the
  sites they allowed.
- Rules in code come first: a site she blocked, or personal details in a URL
  bound for a site she never allowed.
- Then its own small model answers one typed question (allow, ask or block)
  through `glove-classifier`'s `llmClassifier`. Without a key, reads pass and
  writes ask.
- When it says "ask", Muse calls `request_access`. That tool waits for her
  approval only when the Sentinel asked, and her approval is the only way a
  site joins her list. A blocked request stays blocked.

**The vault** (`lib/vault.ts`). Her logins live in a file only this process
user can read.

- A script names one (`credential: "bistro-luna"`), and `env:fetch` adds it as
  a header on that site's origin only.
- `env:secret` lists the logins and hands out references, never values.
- `request_login` asks her to add one in your app. Muse never sees a password.

## Approvals, paying, long work, memory and the log

- **Sending and paying wait for her.** Gmail's send asks for each email.
  `buy` asks for each purchase and pays with a one-time card made for that
  merchant and amount (`lib/payments.ts`). Meta uses Link by Stripe; any
  provider of single-use virtual cards fits. The card number never reaches
  Muse.
- **Long work keeps going.** Muse sets its own checks with
  `glove_foundry_schedule` or `glove_foundry_sleep` and messages her on
  WhatsApp when something changes. New mail that changes a plan reaches her
  the same way.
- **Forget.** `glove_context_set` keeps a fact; `glove_context_unset` forgets
  it when she asks.
- **The log** (`lib/activity.ts`). What Muse did is written from Foundry's
  side of the run, so the model cannot leave anything out:
  - a subscriber records every tool call and how it ended;
  - the Sentinel records every decision.

  What it plans is Foundry's own data: its schedules and wake-ups, and the
  approvals waiting on her. `logFor` puts them together for your app's
  Activity page.

| Meta Muse | Here |
| --- | --- |
| Talk to it in the app or on WhatsApp, like messaging a person | One instance, conversations `app` and `whatsapp`, one memory; WhatsApp is a Foundry app with a transmission each way |
| You choose which apps connect and what each can do, such as read your mail or also send it | The installation's `config.access`: `read` hides every write and turns off the send binding; `act` asks first. `setAccess` and `disconnect` are writes |
| Change access or disconnect a service any time | `setAccess(…)`, `disconnect(…)` |
| Muse Secure VM, with its own browser | A working environment per instance, saved by Foundry; on Kuiper, a sandbox and a browser per person |
| Nothing reaches the internet unless the Sentinel approves it; Sentinel asks you when it needs input | `env:fetch`'s `authorize` runs the Sentinel on every request; "ask" goes to the person through `request_access` |
| The Sentinel is isolated from Muse | It never sees Muse's conversation or what it read; its own model, no tools |
| Uses your logins without seeing your passwords | Logins in a vault; `credential: "<name>"` in `env:fetch`; `env:secret` gives references only |
| Asks before sensitive actions such as sending an email or buying | Gmail's send and `buy` have `requiresPermission` |
| Pays through Link with a one-time card | `buy` gets a one-time card inside the tool; Muse sees the last four digits |
| Keeps working after you close the app, comes back when something changes | `glove_foundry_schedule` / `glove_foundry_sleep`; new mail through the Gmail watch; WhatsApp to tell her |
| Remembers what matters, forgets when told | `defineMemory`; `glove_context_set` / `glove_context_unset` |
| A complete log of everything it has done and plans to do | A subscriber and the Sentinel write what it did; schedules and pending approvals are what it plans |

## Files

`agent.ts` only assembles. What each part does lives beside it.

```
agents/muse/
  agent.ts            assembly: apps, model, memory, tools, VM, REPL, playbooks, log, accounts
  apps/               gmail (MCP + send + watch), calendar (MCP), whatsapp (in + out)
  transmissions/      gmail, whatsapp
  topology.ts         Muse's WhatsApp number and the shared route in
  playbook.ts         WhatsApp from the person; new mail
  sentinel.ts         what may leave the computer, and request_access
  vm.ts               the computer: env:fetch behind the Sentinel, logins from the vault
  tools.ts            buy, request_access, request_login; the access rule for Gmail's send
  prompt.ts  muse.memory.ts  subscribers/activity.subscriber.ts
  connections/  events/  actions/  predicates/
lib/
  accounts.ts         your account store: accounts, tokens, the directory, accountSessions
  connect.ts          connecting an app at an access level; WhatsApp per person
  vault.ts            the person's logins
  payments.ts         one-time cards
  activity.ts         the log: done and planned
  whatsapp.ts         Meta's Cloud API
  oauth.ts  google.ts  mcp-servers.ts  people.ts  models.ts
demo/                 local Gmail and Calendar MCP servers, and sample sites
scripts/
  verify.ts           a day, offline
  onboard.ts          sign a person up on a running Foundry
  connect.ts          connect their Gmail or Calendar at an access level
  whatsapp-webhook.ts Meta's webhook: handshake, signature, forward
```

## Run it

```bash
pnpm install
pnpm --filter glove-foundry-personal-agent verify   # offline, no keys
cp .env.example .env                                 # add ANTHROPIC_API_KEY
pnpm --filter glove-foundry-personal-agent dev       # inspector at http://localhost:4149
pnpm onboard sam "Sam" 15550109999                   # Rosa is seeded; add someone else
pnpm connect sam gmail read                          # needs GOOGLE_CLIENT_ID and friends
```

`verify` runs a day on the real runtime with a scripted model, Rosa's sample
accounts and sample sites:

1. Her Muse is seeded with Gmail and Calendar read only, and WhatsApp on her number.
2. It reads her calendar and inbox in one program.
3. Asked to email Leo, it can't: Gmail is read only, so there is no send tool. She gives it send access, and it sends once she approves.
4. On WhatsApp she tells it Priya is vegetarian, and in the app it knows. A stranger's WhatsApp message wakes nothing.
5. It books dinner from its own computer:
   - the Sentinel lets it read the restaurant's page;
   - the page hides an instruction to send her email address to another site, and the Sentinel blocks it;
   - the Sentinel asks her about the booking, and she allows it;
   - it books with her saved login, which it never sees.
6. It pays for groceries with a one-time card once she approves.
7. It sets itself to watch a train fare every 6 hours.
8. New mail that moves the dinner reaches her on WhatsApp.
9. She asks it to forget Priya, and it does.
10. Its log shows what it did and what it plans. She disconnects Calendar.

The run also checks that her login and the card number appear nowhere in
Muse's data. Sample sends and purchases are listed in `.data/ledger.jsonl`, and
the log is in `.data/activity.jsonl`.

## Connect real accounts and WhatsApp

- **Gmail and Calendar.** Create a Google OAuth client with the Gmail, Gmail
  MCP, Calendar and Calendar MCP APIs enabled and
  `http://127.0.0.1:53683/callback` as a redirect URI. For new mail, create a
  Pub/Sub topic that `gmail-api-push@system.gserviceaccount.com` may publish
  to, a pull subscription, and a service account that may pull. Set the
  `GOOGLE_*` and `GMAIL_PUBSUB_*` variables, then
  `pnpm connect <person> gmail read`.
- **WhatsApp.** In Meta's developer app, add WhatsApp and note the phone
  number id; make a system user token. Run `pnpm whatsapp-webhook` somewhere
  public and register its URL with your `WHATSAPP_VERIFY_TOKEN`. Set
  `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TOKEN` and `WHATSAPP_APP_SECRET`.
  WhatsApp only takes free text within 24 hours of the person's last message;
  outside that window, send a template.

## Deploy on Kuiper

Copy the folder into its own repository and swap the `workspace:*` versions for
published ones. Then:

```bash
kuiper login
kuiper projects create muse && kuiper use muse
kuiper units create muse

kuiper providers add anthropic --key -            # once per organisation
kuiper secrets set GOOGLE_CLIENT_SECRET=- GOOGLE_SERVICE_ACCOUNT_JSON=- WHATSAPP_TOKEN=- FOUNDRY_TOKEN=-
kuiper env set -u muse MUSE_DATA_DIR=/data \
  'ANTHROPIC_API_KEY=${{models.API_KEY}}' \
  'ANTHROPIC_BASE_URL=${{models.ANTHROPIC_BASE_URL}}' \
  GOOGLE_CLIENT_ID=… 'GOOGLE_CLIENT_SECRET=${{secrets.GOOGLE_CLIENT_SECRET}}' \
  GMAIL_PUBSUB_TOPIC=… GMAIL_PUBSUB_SUBSCRIPTION=… \
  'GOOGLE_SERVICE_ACCOUNT_JSON=${{secrets.GOOGLE_SERVICE_ACCOUNT_JSON}}' \
  WHATSAPP_PHONE_NUMBER_ID=… 'WHATSAPP_TOKEN=${{secrets.WHATSAPP_TOKEN}}' \
  'FOUNDRY_TOKEN=${{secrets.FOUNDRY_TOKEN}}'

kuiper deploy --source . -u muse --wait
kuiper dashboard -u muse --enable                 # inspector login
kuiper logs -u muse -f
```

The WhatsApp webhook runs as a second unit from the same source. It is the only
public way in, and it reaches Foundry over the private address. Its public URL
is the webhook URL you register with Meta:

```bash
kuiper units create whatsapp-webhook
kuiper settings -u whatsapp-webhook --start-command "pnpm whatsapp-webhook" --port 4150
kuiper secrets set WHATSAPP_APP_SECRET=-
kuiper env set -u whatsapp-webhook 'WHATSAPP_APP_SECRET=${{secrets.WHATSAPP_APP_SECRET}}' WHATSAPP_VERIFY_TOKEN=… \
  'FOUNDRY_TOKEN=${{secrets.FOUNDRY_TOKEN}}' 'FOUNDRY_URL=${{muse.INTERNAL_URL}}'
kuiper deploy --source . -u whatsapp-webhook --wait
```

Conversations, memory, accounts, tokens, logins, the Sentinel's lists, the log
and each Muse's computer sit on the `/data` disk, so they survive restarts and
redeploys. New mail needs nothing public: the Gmail watch pulls its
subscription from inside the unit.

On Kuiper you can swap in a managed computer:

- **The computer.** Replace `agents/muse/vm.ts` with a sandbox and a browser
  per person (`kuiper.sandboxes.create(…)`, `kuiper.browsers.create()` from
  `@kuiper-sh/sdk`). Keep the Sentinel in front of them: route the browser
  through a proxy that asks it, the way `env:fetch` does here.

## Where it differs

- Muse browses with a real browser that the person can watch. Here the web is
  `env:fetch` from scripts until you swap in a Kuiper browser, and the Sentinel
  sees requests, not page actions.
- The Sentinel here judges one request at a time. Muse's runs as an agent on
  the same machine and can ask the person directly. Here its question reaches
  the person through Muse's `request_access`, though only the person's
  approval changes what is allowed.
- Purchases go through `buy` with a provider's one-time card, not through a
  checkout page in the browser.
- There is no Instagram connector and no AI glasses.

## Sources

- [Introducing Muse](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/), Meta
- [Meta Muse review](https://www.eesel.ai/blog/meta-muse-agent-review), eesel
- [WhatsApp Cloud API: get started](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started), Meta for Developers
