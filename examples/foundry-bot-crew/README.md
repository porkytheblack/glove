# Bot crew

AI teammates you keep around, built with Glove Foundry. It follows the shape of
Grok Bot: a person makes bots, each with a name, a job and a working style. The
bots are siblings, with no coordinator kind. One sibling is starred as the
Primary Bot: it takes the asks that name no bot and hands specialists their
part. The star is data you can move. Each bot runs when its person writes to
it, when it is @-mentioned in a group chat, when a sibling hands it work, or
when one of its routines fires. Every bot works in the apps the person
connected (Gmail, Linear, any app with an MCP server), learns skills, and comes
back when something needs approval.

This is an independent example. It is not affiliated with or endorsed by xAI
(SpaceXAI) or Cursor, and it is not how Grok Bot is built.

## One definition, every bot in data

There is one definition, `agents/bot/agent.ts`. It says what any bot can be.
Every bot is an instance of it:

```
  Maya's workspace (her account)
  ┌──────────────────────────────────────────────────────────────────────┐
  │  Inbox Manager     Sales Outbound      Bug Triage  ───►  Engineer    │
  │  starred           (was "New bot")     routine: new mail             │
  │  routine: new mail                                                   │
  │        siblings: each bot is a row; they message each other by id   │
  │  her accounts on every bot: gmail (maya-gmail), linear (maya-linear) │
  │  one computer and one skill library for all of them                  │
  └──────────────────────────────────────────────────────────────────────┘
```

- **Name, job and working style** are the instance's `name`, `description` and
  `context.style`. A new bot has none: it asks what it is for, then calls
  `take_job`, which writes them. Each bot keeps its own memory and
  preferences; files live on the shared computer.
- **Siblings, one starred.** There is no coordinator kind. One sibling has
  `context.starred`: it is the Primary Bot, takes the asks that name no bot
  and hands specialists their part over the mesh. `starBot` moves the star.
  A bot runs when:
  - its person writes to it, in its own chat; an ask that names no bot goes
    to the starred one (`askPrimary` in `lib/groups.ts`);
  - it is @-mentioned in a group chat, or the message mentions nobody;
  - a sibling hands it work over Glove Mesh;
  - one of its routines fires: on a schedule (a Foundry schedule the bot owns)
    or after an event (new mail, a playbook built from `context.routines`).
- **Apps are the person's**, not a bot's. Connecting one saves the person's
  account and installs the app with that account on every one of their bots; a
  bot made later gets the same.
- **Teammates** are the other instances in the person's workspace. Bots message
  each other by id over Glove Mesh, which Foundry hosts.
- **A group chat** has no host. Each member keeps its own conversation for it,
  whose `context.group` lists the members, and your app shows them merged.
  In this build, `postToGroup` (`lib/groups.ts`) sends a message to the bots
  it @-mentions, or to every member when it mentions nobody or says
  `@everyone`; a bot with nothing to add replies with nothing.
- **Skills** are the person's library. Any bot runs one when a message names
  it with `/`, like `/monday-signups`; bots read them with `glove_read_skill`.
- **Limits** follow Grok Bot's: at most 50 bots per person (`makeBot` in
  `lib/connect.ts`) and 50 routines per bot (`add_routine` and
  `glove_foundry_schedule`).
- **Copies and templates** (`lib/templates.ts`). `duplicateBot` copies a bot's
  name, job, style, routines (schedules included) and app installations, not
  its memory or chats. `templateOf` makes a template: its instructions, the
  memories you pick, skills, routines and first-party apps with their approval
  rules, without chats, accounts, keys, custom MCP servers or scripts.
  `fromTemplate` makes a bot from one, and `MARKETPLACE` lists two ready-made
  ones.
- **The model** is the same for every bot.

Making a bot, renaming it or connecting an app is a write. None of it needs a
deploy.

## Connected apps

An app is a Foundry app (`agents/bot/apps/*.app.ts`), installed per bot with
the person's account. It owns everything about talking to that provider:

```
                     ┌───────────── gmail.app.ts ──────────────┐
  Google's Gmail MCP │ mcp: search, read, draft                │ ──► gmail.search_threads(…) in code
  server             │   opened with Maya's account            │
                     │ outbound: send (transmission)           │ ──► Foundry delivers it, after she approves
  Gmail push ──────► │ connections: gmail-watch                │ ──► new mail to each bot whose routine asks
  (Pub/Sub)          └─────────────────────────────────────────┘
                          ▲ every call: accountSessions("maya-gmail", operation)
                          │ tokens stay in your store (lib/accounts.ts)
```

- **Reads come from the provider's MCP server**, opened with the installation's
  account. The app's `mcp.tools` policy decides each tool: reads run; anything
  else asks first, unless the person chose "Always allow" for it (a write to the
  installation's `config.alwaysAllow`). A require-approval rule in
  `config.alwaysAsk` wins: that tool asks even if it is always allowed.
- **The bot reads in code.** The REPL projects each installed app as a group of
  functions (`gmail.search_threads`, `linear.list_issues`), so a bot reads
  across apps in one program instead of carrying every tool in context. A tool
  that asks first stays a direct tool, so the person sees the approval.
- **Sending is the Gmail transmission's outbound side.** Google's server has no
  send. Foundry runs the delivery in its own process, inside the account
  session, after the person approves the exact email, and only for a bot whose
  binding grants `gmail:send`. The bot never holds the token.
- **New mail arrives through the `gmail-watch` connection.** Foundry runs one
  per connected account, only while a bot has Gmail installed and its playbook
  wants mail. It calls `users.watch` daily (Google requires every 7 days), pulls
  the Pub/Sub subscription, reads `history.list` with the person's token and
  passes each message in, claimed once by its Gmail id.
- **Linear is an app that is only an MCP server.** Most apps look like it; add a
  transmission when the provider pushes events or a send must be delivered
  outside the agent.

Connecting (`lib/connect.ts`, run by `pnpm connect`) is what your OAuth callback
does: save the account and its tokens (`lib/accounts.ts`), write Gmail's routes
in and out, then install the app and a send binding on each of the person's
bots. Foundry reads accounts through your directory (`services`) and never
stores or refreshes a token; `accountSessions` does, inside the boundary.

| Grok Bot | Here |
| --- | --- |
| Make a bot with a name, a job and a working style (up to 50) | `makeBot(…)` with no job; it asks "what do you want me around for?" and calls `take_job`, a tool that writes its name, job and style to its own instance |
| Bots are siblings, each with its own chat | One definition, an instance per bot, a `chat` conversation per bot; no coordinator kind |
| A starred Primary Bot takes asks that name no bot and routes to specialists | `context.starred` on one bot (`starBot` moves it); `askPrimary` sends it the ask, and it hands siblings their part over the mesh |
| Connect apps (Gmail and more) for all your bots | A Foundry app per provider, installed on every bot with the person's account: MCP reads, transmission sends, a connection for incoming events |
| A bot asks for access as it needs it | `connect_app` asks; the approval is your Connect button, which runs the provider's sign-in and saves the account |
| Allow once, deny, or an always-allow rule; require-approval rules win | Approvals on tools that ask; "Always allow" adds the tool to the installation's `alwaysAllow`, and `alwaysAsk` overrides it |
| Bots pass work and ownership | `glove_mesh_send_message` by instance id; each handoff names the output under `/workspace`, what is done, evidence, open questions and the next owner |
| Group chats of 2–6 bots | A conversation per member, whose data lists the members; here a message goes to the bots it @-mentions (all of them for `@everyone` or no mention) |
| One computer for all your bots | `foundryDataEnvironmentPersistence({ scope: "workspace" })` |
| Sign-in handed back to you | `request_sign_in` waits for you. It is a stand-in here, with no browser behind it; on Kuiper, `browser.handOff` on a `kuiperBrowser` does it for real (see the personal-agent example) |
| Skills any bot can use, invoked with `/` | `save_skill` (the person reviews it) writes a workspace entry every bot reads; `/name` in a message runs it on any bot |
| A routine assigns a workflow to one bot, on a schedule or after an event (up to 50 per bot) | On a schedule: `glove_foundry_schedule`, owned by that bot. After an event: `add_routine` writes `context.routines`, and the bot's playbook is built from it |
| Duplicate a bot; templates and a marketplace | `duplicateBot`, `templateOf`, `fromTemplate` and `MARKETPLACE` in `lib/templates.ts` |

## Files

```
agents/bot/
  agent.ts            the one definition: apps it may have, REPL, playbook, skills by /name, accountSessions
  prompt.ts           built from the bot's data: name, job, style, star, routines, apps, group chat
  tools.ts            take_job, connect_app, save_skill, add_routine, request_sign_in, the skill library
  playbook.ts         a routine on new mail, built from the bot's data
  apps/               gmail (MCP + send + watch), linear (MCP)
  transmissions/      gmail: new mail in, email out
  connections/        gmail-watch: users.watch, Pub/Sub, history.list
  skills.ts  computer.ts  bot.memory.ts  events/  actions/
lib/
  accounts.ts         your account store: accounts, tokens, the directory, accountSessions
  connect.ts          connecting an app: account, routes, installations, bindings; makeBot
  oauth.ts            Google and Linear OAuth, token refresh
  google.ts           Gmail and Pub/Sub over REST
  mcp-servers.ts      each app's MCP server, credentials and tool policy
  people.ts           an account as data: botFor, chatWith, routines, primaryOf, starBot
  groups.ts           messages from your app: askPrimary, and group chats (openGroup, postToGroup)
  templates.ts        duplicateBot, templateOf, fromTemplate, the marketplace
  models.ts           the model per bot, and scripts for offline runs
  host.ts             what the web app's server calls: lib/, with the file ids bound by discovery
app/                  the web app (Next.js): sign-in, bots and chats, group chats, profiles, templates, apps
  server/             its server side: the host functions, workspace checks, chat and group views
  ui/                 the screens' browser parts, on the kit's components
demo/                 local MCP servers with Google's and Linear's tool names, for sample accounts
scripts/
  verify.ts           a whole day, offline
  web-smoke.ts        the web app in a real browser, offline
  start.mjs           Foundry on loopback and the web app on $PORT, as one unit
  dev.mjs             both, for development
  invite.ts           a sign-in link for one person
  onboard.ts          sign a person up on a running Foundry
  connect.ts          connect one of their apps through the provider's sign-in
```

## Run it

```bash
pnpm install
pnpm --filter glove-foundry-bot-crew verify   # offline, no keys
cp .env.example .env                          # add ANTHROPIC_API_KEY
pnpm --filter glove-foundry-bot-crew dev      # the web app at http://localhost:3000, the inspector at http://localhost:4143
pnpm onboard ada "Ada"
pnpm connect ada gmail                        # needs GOOGLE_CLIENT_ID and friends
```

`verify` runs on the real runtime with scripted models and Maya's sample
accounts, whose apps use the local servers in `demo/`:

1. Maya's account is seeded: her first bot, Inbox Manager, starred, with her Gmail and a routine on new mail; the watch is connected.
2. She makes a new bot and tells it its job; it names itself Sales Outbound, keeps a working style and gets her apps.
3. Bug Triage asks for Linear; she signs in and always allows filing; all four bots have it.
4. She tells Bug Triage about a bug; it files it in Linear and hands the fix to Engineer, a sibling.
5. Sales Outbound finds this week's signups in her inbox in code and emails Dana once she approves.
6. A Salesforce sign-in waits for her. With no browser here, the bot says so instead of pretending.
7. A workflow she describes becomes a skill (after she reviews it) and Sales Outbound's Monday routine; Bug Triage adds a routine on new mail.
8. In the Offsite crew group chat she @-mentions two bots; both answer, and the third member stays quiet.
9. New mail from Lena wakes the two bots with a routine on new mail: Bug Triage passes, and Inbox Manager replies in Lena's thread once she approves.
10. She asks how the week looks without naming a bot. It goes to Inbox Manager, the starred bot, which answers for the inbox and asks Sales Outbound for the leads. Then the star moves and back.
11. `/monday-signups` in Inbox Manager's chat runs the skill Sales Outbound saved.
12. She duplicates Sales Outbound: the copy has its job, style, apps and Monday routine, and none of its memory or chats. Its template carries no accounts.

Sample sends and issues are listed in `.data/ledger.jsonl`.

## The web app

Maya's side of it, in `app/`: a Next.js app that runs next to Foundry and
shares its `/data`. It is built on the shared kit in
`examples/foundry-web-kit`.

- **Bots.** Her bots, the starred Primary Bot first, each with what it is
  doing (working, waiting for her approval, a routine's time, no job yet), and
  her group chats. A bot's chat streams its reply in as it is written, with
  the tools it used above each reply and a chip when it hands work to a
  sibling. An approval shows inline with what will happen (an email's from,
  to, subject and body): Allow once, Always allow, or Deny. Always allow adds
  the tool to that bot's installation (`alwaysAllow`) and approves; it is
  offered for app tools only, since sending email always asks. Ask, with no
  bot open, sends a message that names no bot to the Primary Bot
  (`askPrimary`).
- **Group chats.** One thread from every member's side (`openGroup`,
  `postToGroup`): the bots she @-mentions answer, or all of them. Members,
  and Add a bot.
- **A bot's profile.** Name, job and working style (a write to the
  instance), the star, its routines (after an event and on a schedule),
  the skill library, its apps with what runs without asking, and what it
  remembers, read-only. Duplicate (`duplicateBot`) and Save as template
  (`templateOf`).
- **Templates.** A blank bot (`makeBot`), the marketplace and her saved
  templates (`fromTemplate`).
- **Apps.** Each app's accounts, its transmissions in (with the account
  being watched) and out, and the playbooks that take what comes in: the
  bots with a routine on new mail. Connect an app runs the provider's
  sign-in when its OAuth client is set; register
  `<WEB_URL>/api/apps/<app>/callback` as a redirect URI.

The browser only talks to the app's server. That server holds
`FOUNDRY_TOKEN` and calls Foundry on loopback; every API route checks the
session, then checks that Maya's workspace owns the bot, conversation, run or
approval it names, and answers 404 otherwise. What reaches the page is cut
down to what it shows: no tokens, prompts or raw tool results. Live updates
are server-sent events at `/api/runs/<id>/live`, which pass on only text,
tool names, approvals and the run's start and end.

```bash
pnpm --filter glove-foundry-bot-crew dev          # Foundry dev + next dev on :3000
pnpm --filter glove-foundry-bot-crew build        # next build
pnpm --filter glove-foundry-bot-crew start        # Foundry on 127.0.0.1:4141 + next start on $PORT
pnpm --filter glove-foundry-bot-crew web-smoke    # offline, in Chromium
```

**Signing in.** `pnpm invite maya` prints `<WEB_URL>/signin?t=…`, a link for
Maya that works for 7 days. Its token is HMAC-SHA256 with
`WEB_SESSION_SECRET` over her id and the expiry. Opening it sets an HttpOnly
`session` cookie for 30 days (Secure over https); her workspace is her id.
Sign out from the avatar menu. With no `WEB_SESSION_SECRET` in development,
the sign-in page offers Maya directly; in production the secret is required.

`web-smoke` builds if needed, starts the unit with scripted models
(`CREW_DEMO=1`) and signs Maya in through an invite link. She writes to Inbox
Manager and its reply streams in; she asks it to reply to Dan, allows the
email once, and it goes out; another person's bot, run and page answer 404.

## Try it: the demo connector

Set `DEMO_CONNECTORS=1` and the web app serves a mock Gmail, with a **Try it**
link at `/demo`. Mail you deliver there:

1. goes to the app's own `/webhooks/mail` at `WEB_URL`, signed with
   `MOCK_MAIL_SECRET`. `scripts/demo-connectors.mjs` derives it from
   `WEB_SESSION_SECRET`. The route exists only in this mode; real Gmail comes
   in through the Gmail watch.
2. lands in the person's sample mailbox (`demo/mailbox.ts`, read by
   `demo/gmail-mcp.ts`) and fires the account's inbound route.
3. wakes each bot with a routine on new mail, in its own chat. The page links
   to them. A reply waits there for approval.

The person needs Gmail connected first; the sample account is enough. Every
hop goes in `<CREW_DATA_DIR>/demo-connectors.jsonl`, and the page shows it as
a delivery log. A person can send at most 20 an hour, since each mail can wake
several bots.

## Connect real accounts

- **Gmail.** Create a Google OAuth client with the Gmail API and the Gmail MCP
  API enabled (the MCP server is in developer preview) and
  `http://127.0.0.1:53683/callback` as a redirect URI. Create a Pub/Sub topic,
  let `gmail-api-push@system.gserviceaccount.com` publish to it, add a pull
  subscription, and make a service account that may pull. Set the `GOOGLE_*`
  and `GMAIL_PUBSUB_*` variables, then `pnpm connect <person> gmail`.
- **Linear.** Create a Linear OAuth app with the same redirect URI, set
  `LINEAR_CLIENT_ID` and `LINEAR_CLIENT_SECRET`, then `pnpm connect <person> linear`.

`pnpm connect` writes the account to the data folder and the routes, bindings
and installations to the running Foundry, so run it where `CREW_DATA_DIR` is. In
a web app, put the same calls behind your own Connect button.

## Deploy on Kuiper

Copy the folder into its own repository and swap the `workspace:*` versions for
published ones. Then:

```bash
kuiper login
kuiper projects create crew && kuiper use crew
kuiper units create crew

kuiper providers add anthropic --key -            # once per organisation
kuiper secrets set GOOGLE_CLIENT_SECRET=- GOOGLE_SERVICE_ACCOUNT_JSON=- LINEAR_CLIENT_SECRET=- FOUNDRY_TOKEN=- WEB_SESSION_SECRET=-
kuiper env set -u crew CREW_DATA_DIR=/data \
  'FOUNDRY_TOKEN=${{secrets.FOUNDRY_TOKEN}}' \
  'WEB_SESSION_SECRET=${{secrets.WEB_SESSION_SECRET}}' WEB_URL=https://… \
  'ANTHROPIC_API_KEY=${{models.API_KEY}}' \
  'ANTHROPIC_BASE_URL=${{models.ANTHROPIC_BASE_URL}}' \
  GOOGLE_CLIENT_ID=… 'GOOGLE_CLIENT_SECRET=${{secrets.GOOGLE_CLIENT_SECRET}}' \
  GMAIL_PUBSUB_TOPIC=… GMAIL_PUBSUB_SUBSCRIPTION=… \
  'GOOGLE_SERVICE_ACCOUNT_JSON=${{secrets.GOOGLE_SERVICE_ACCOUNT_JSON}}' \
  LINEAR_CLIENT_ID=… 'LINEAR_CLIENT_SECRET=${{secrets.LINEAR_CLIENT_SECRET}}'

kuiper deploy --source . -u crew --wait
kuiper logs -u crew -f
```

`kuiper.json` starts `scripts/start.mjs` under `tini` and makes port 3000 public.

Model calls go through Kuiper's model gateway, so the Anthropic key stays with
the organisation and every call is counted. If the organisation's key is an
OpenRouter key, set `'MODELS_BASE_URL=${{models.BASE_URL}}'`,
`'MODELS_API_KEY=${{models.API_KEY}}'` and
`BOT_MODEL=openrouter/anthropic/claude-sonnet-5.5` instead of the two
`ANTHROPIC_` variables: a model name with a slash goes through the gateway's
Chat Completions route, with prompt caching on. Bots, threads, skills, accounts,
tokens, routes and bindings, transcripts, memory and the computers sit on the
`/data` disk. A new bot or a new connection is a write there, not a redeploy.
New mail needs nothing public: the Gmail watch pulls its subscription from
inside the unit.

`pnpm start` runs both processes in the unit: the web app on the public port,
and Foundry on loopback, so the browser never reaches Foundry. Set
`FOUNDRY_TOKEN` anyway: `lib/authorization.ts` makes Foundry check it, and
the web app sends it. Make invite links anywhere the secret is known:
`WEB_SESSION_SECRET=… WEB_URL=https://… pnpm invite maya`. To run Foundry
alone on a public address instead (its API and inspector, no web app), start
it with `glove foundry start`; it then needs that token or the inspector
login `kuiper dashboard --enable` sets.

For a real computer and browser, mount a Kuiper sandbox and a Kuiper browser
per person with `kuiperSandbox` and `kuiperBrowser` from
`glove-execution/kuiper`, in place of `agents/bot/computer.ts`. A browser with a
profile per person carries a sign-in over. The personal-agent example shows the
browser.

## Where it differs

- Grok Bot launched in beta on 11 August 2026 and runs on Cursor's cloud.
  SpaceXAI picks its model, with no picker and automatic failover. Here the
  operator sets one model for every bot (`BOT_MODEL`), with no failover.
- Grok Bot has plugins invoked with @, native Google Docs, Sheets and Slides,
  API-key connectors, custom MCP servers, Stripe Link, X (posting is
  approval-gated) and Plaid (read-only). Here there are two apps, Gmail and
  Linear; any app with a hosted MCP server is another file like
  `linear.app.ts`, and an aggregator's MCP server can stand in for many at once.
- Teach a task (a bot watching you work in the browser for up to 10 minutes,
  then drafting a skill) isn't built here. In Foundry it would start from a
  Kuiper browser you drive through `browser.handOff`, with the session
  recording on; drafting a skill from that recording is the missing part.
  Here a skill comes from a workflow you describe, through `save_skill`.
- There are no Team Bots. In Grok Bot (public beta since 28 September 2026)
  an owner publishes one shared bot; each teammate gets a private chat the
  owner can't read, memory is team-wide plus per person, and a custom Slack
  app can be deployed.
- Approvals are per tool, with "Always allow" and "Always ask" kept per
  installation. In Grok Bot, sensitive actions can also pass through Auto
  Review first; the Dots rebuild (`examples/foundry-standing-agents`) shows an
  auto-review with its rules kept as data.
- The 50-routine cap is checked in `add_routine` and, through `configure`,
  in Foundry's `glove_foundry_schedule`: both count the bot's event routines,
  the schedules it carried as data and its own recurring schedules. A one-off
  reminder isn't a routine.
- As in Grok Bot, isolation is per person, so bots are not a boundary from
  each other: they share one computer and every app their person connects.
  Deleting a bot leaves its files on the computer.
- The only event a routine can follow here is new mail. Another event is
  another connection and playbook on the app that owns it.
- The computer is a Glove working environment: files and scripts, no shell, git
  or test runner, and no browser. Engineer's fixes and Salesforce's sign-in are
  scripted here. Mount a Kuiper sandbox (`kuiperSandbox` with
  `kuiper/coding`) and browser (`kuiperBrowser`) per person from
  `glove-execution/kuiper` for the real thing.
- On a run that new mail started, the computer has no web, so an email that
  tells a bot to send what it read elsewhere has nowhere to send it.
- A direct message to a busy bot starts the next run; in Grok Bot it redirects
  the current turn. Foundry's steering (the client's `steerRun`) does that if your app calls
  it.

## Deliberately left out

Grok Bot can route bot traffic through your desktop to get past datacenter-IP
blocks. This build leaves that out on purpose: it exposes your local network to
every bot, and it exists to get around sites' blocks.

## Sources

- [Grok Bot overview](https://cursor.com/docs/grok-bot), [Work with Grok Bot](https://cursor.com/docs/grok-bot/work), [Get started](https://cursor.com/docs/grok-bot/get-started), [Teams](https://cursor.com/docs/grok-bot/teams) and [Security](https://cursor.com/docs/grok-bot/security), Cursor docs
- [Skills and routines](https://docs.x.ai/grok-bot/skills-routines-and-automations) and [FAQ](https://docs.x.ai/grok-bot/faq), xAI docs
- [Introducing Grok Bot](https://x.ai/news/introducing-grok-bot) and [Grok Bot 101](https://x.ai/bot/guides/grok-bot-101), xAI
- [Push notifications](https://developers.google.com/workspace/gmail/api/guides/push), [history.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list) and [the Gmail MCP server](https://developers.google.com/workspace/gmail/api/reference/mcp), Google
- [Linear MCP server](https://linear.app/docs/mcp), Linear
