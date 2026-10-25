# Bot crew

AI teammates you keep around, built with Glove Foundry. It follows the shape of
Grok Bot: a person makes bots, names them and gives each a job. The bots are
siblings: none sits above the others. Each one runs when its person writes to
it, when it is @-mentioned in a group chat, when a sibling hands it work, or
when one of its routines fires. Every bot works in the apps the person
connected (Gmail, Linear, any app with an MCP server), learns skills, and comes
back when something needs approval.

This is an independent example. It is not affiliated with or endorsed by xAI,
and it is not how Grok Bot is built.

## One definition, every bot in data

There is one definition, `agents/bot/agent.ts`. It says what any bot can be.
Every bot is an instance of it:

```
  Maya's workspace (her account)
  ┌──────────────────────────────────────────────────────────────────────┐
  │  Inbox Manager     Sales Outbound      Bug Triage  ───►  Engineer    │
  │  routine: new mail (was "New bot")     routine: new mail             │
  │        siblings: each bot is a row; they message each other by id   │
  │  her accounts on every bot: gmail (maya-gmail), linear (maya-linear) │
  │  one computer and one skill library for all of them                  │
  └──────────────────────────────────────────────────────────────────────┘
```

- **Name and job** are the instance's `name` and `description`. A new bot has
  neither: it asks what it is for, then calls `take_job`, which writes them.
- **Siblings.** No bot routes work to the others. A bot runs when:
  - its person writes to it, in its own chat;
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
  `postToGroup` (`lib/groups.ts`) sends a message to the bots it @-mentions,
  or to every member when it mentions nobody or says `@everyone`; a bot with
  nothing to add replies with nothing.
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
  installation's `config.alwaysAllow`).
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
| Make a bot, name it and give it a job | `createAgent("bot", botFor(…))` with no job; it asks "what do you want me around for?" and calls `take_job`, a tool that writes its own instance |
| Bots are equals, each with its own chat | One definition, an instance per bot, a `chat` conversation per bot; nothing routes between them |
| Connect apps (Gmail and more) for all your bots | A Foundry app per provider, installed on every bot with the person's account: MCP reads, transmission sends, a connection for incoming events |
| A bot asks for access as it needs it | `connect_app` asks; the approval is your Connect button, which runs the provider's sign-in and saves the account |
| Allow once, Always allow, Deny | Approvals on tools that ask; "Always allow" adds the tool to the installation's `alwaysAllow` |
| Bots pass work and ownership | `glove_mesh_send_message` by instance id; each handoff names the output under `/workspace`, what is done, evidence, open questions and the next owner |
| Group chats of 2–6 bots | A conversation per member, whose data lists the members; a message goes to the bots it @-mentions (all of them for `@everyone` or no mention) |
| One computer for all your bots | `foundryDataEnvironmentPersistence({ scope: "workspace" })` |
| Sign-in handed back to you | `request_sign_in` hands the computer back for SSO, a passkey or a CAPTCHA |
| Skills shared across bots | `save_skill` (the person reviews it) writes a workspace entry every bot reads |
| A routine assigns a workflow to one bot, on a schedule or after an event | On a schedule: `glove_foundry_schedule`, owned by that bot. After an event: `add_routine` writes `context.routines`, and the bot's playbook is built from it |

## Files

```
agents/bot/
  agent.ts            the one definition: apps it may have, REPL, playbook, accountSessions
  prompt.ts           built from the bot's data: name, job, routines, apps, group chat
  tools.ts            take_job, connect_app, save_skill, add_routine, request_sign_in, the skill library
  playbook.ts         a routine on new mail, built from the bot's data
  apps/               gmail (MCP + send + watch), linear (MCP)
  transmissions/      gmail: new mail in, email out
  connections/        gmail-watch: users.watch, Pub/Sub, history.list
  skills.ts  computer.ts  bot.memory.ts  events/  actions/
lib/
  accounts.ts         your account store: accounts, tokens, the directory, accountSessions
  connect.ts          connecting an app: account, routes, installations, bindings
  oauth.ts            Google and Linear OAuth, token refresh
  google.ts           Gmail and Pub/Sub over REST
  mcp-servers.ts      each app's MCP server, credentials and tool policy
  people.ts           an account as data: botFor, chatWith, routines
  groups.ts           group chats: openGroup, postToGroup (your app's code)
  models.ts           the model per bot, and scripts for offline runs
demo/                 local MCP servers with Google's and Linear's tool names, for sample accounts
scripts/
  verify.ts           a whole day, offline
  onboard.ts          sign a person up on a running Foundry
  connect.ts          connect one of their apps through the provider's sign-in
```

## Run it

```bash
pnpm install
pnpm --filter glove-foundry-bot-crew verify   # offline, no keys
cp .env.example .env                          # add ANTHROPIC_API_KEY
pnpm --filter glove-foundry-bot-crew dev      # inspector at http://localhost:4143
pnpm onboard ada "Ada"
pnpm connect ada gmail                        # needs GOOGLE_CLIENT_ID and friends
```

`verify` runs on the real runtime with scripted models and Maya's sample
accounts, whose apps use the local servers in `demo/`:

1. Maya's account is seeded: her first bot, Inbox Manager, with her Gmail and a routine on new mail; the watch is connected.
2. She makes a new bot and tells it its job; it names itself Sales Outbound and gets her apps.
3. Bug Triage asks for Linear; she signs in and always allows filing; all four bots have it.
4. She tells Bug Triage about a bug; it files it in Linear and hands the fix to Engineer, a sibling.
5. Sales Outbound finds this week's signups in her inbox in code and emails Dana once she approves.
6. A Salesforce sign-in is handed back to her.
7. A workflow she describes becomes a skill (after she reviews it) and Sales Outbound's Monday routine; Bug Triage adds a routine on new mail.
8. In the Offsite crew group chat she @-mentions two bots; both answer, and the third member stays quiet.
9. New mail from Lena wakes the two bots with a routine on new mail: Bug Triage passes, and Inbox Manager replies in Lena's thread once she approves.

Sample sends and issues are listed in `.data/ledger.jsonl`.

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
kuiper secrets set GOOGLE_CLIENT_SECRET=- GOOGLE_SERVICE_ACCOUNT_JSON=- LINEAR_CLIENT_SECRET=-
kuiper env set -u crew CREW_DATA_DIR=/data \
  'ANTHROPIC_API_KEY=${{models.API_KEY}}' \
  'ANTHROPIC_BASE_URL=${{models.ANTHROPIC_BASE_URL}}' \
  GOOGLE_CLIENT_ID=… 'GOOGLE_CLIENT_SECRET=${{secrets.GOOGLE_CLIENT_SECRET}}' \
  GMAIL_PUBSUB_TOPIC=… GMAIL_PUBSUB_SUBSCRIPTION=… \
  'GOOGLE_SERVICE_ACCOUNT_JSON=${{secrets.GOOGLE_SERVICE_ACCOUNT_JSON}}' \
  LINEAR_CLIENT_ID=… 'LINEAR_CLIENT_SECRET=${{secrets.LINEAR_CLIENT_SECRET}}'

kuiper deploy --source . -u crew --wait
kuiper dashboard -u crew --enable                 # inspector login
kuiper logs -u crew -f
```

Model calls go through Kuiper's model gateway, so the Anthropic key stays with
the organisation and every call is counted. Bots, threads, skills, accounts,
tokens, routes and bindings, transcripts, memory and the computers sit on the
`/data` disk. A new bot or a new connection is a write there, not a redeploy.
New mail needs nothing public: the Gmail watch pulls its subscription from
inside the unit.

For a real computer and browser, swap `agents/bot/computer.ts` for a Kuiper
sandbox per person (`kuiper.sandboxes.create({ image: "kuiper/coding" })`) and
a Kuiper browser with a profile per person, so a sign-in carries over; both from
`@kuiper-sh/sdk`.

## Where it differs

- Grok Bot connects thousands of apps. Here there are two; any app with a hosted
  MCP server is another file like `linear.app.ts`, and an aggregator's MCP server
  can stand in for many at once.
- Skills are taught by describing a workflow, not by recording the screen with
  Teach a task.
- There are no Team Bots (one bot shared with a team, a private chat per
  teammate, running on each teammate's computer).
- Approvals are per tool, with "Always allow" kept per installation. Grok Bot also
  runs an auto-review model with natural-language "Ask first" and "Allow
  automatically" rules; see the Dots rebuild (`examples/foundry-standing-agents`).
- The only event a routine can follow here is new mail. Another event is
  another connection and playbook on the app that owns it.
- The computer is a Glove working environment (files and scripts) until you swap
  in a Kuiper sandbox and browser per person.
- A direct message to a busy bot starts the next run; in Grok Bot it redirects
  the current turn. Foundry's steering (the client's `steerRun`) does that if your app calls
  it.

## Sources

- [Grok Bot overview](https://cursor.com/docs/grok-bot), [Work with Grok Bot](https://cursor.com/docs/grok-bot/work), [Get started](https://cursor.com/docs/grok-bot/get-started), [Teams](https://cursor.com/docs/grok-bot/teams) and [Security](https://cursor.com/docs/grok-bot/security), Cursor docs
- [Skills and routines](https://docs.x.ai/grok-bot/skills-routines-and-automations) and [FAQ](https://docs.x.ai/grok-bot/faq), xAI docs
- [Grok Bot 101](https://x.ai/bot/guides/grok-bot-101), xAI
- [Push notifications](https://developers.google.com/workspace/gmail/api/guides/push), [history.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list) and [the Gmail MCP server](https://developers.google.com/workspace/gmail/api/reference/mcp), Google
- [Linear MCP server](https://linear.app/docs/mcp), Linear
