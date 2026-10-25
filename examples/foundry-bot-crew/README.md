# Bot crew

AI teammates you keep around, built with Glove Foundry. It follows the shape of
Grok Bot: a person makes bots, names them and gives each a job; their main bot
takes everyday requests and routes the rest; bots message each other, share
group chats and pass work along; they all work on one computer with the apps
the person connected; they learn skills and run them as routines; and they come
back when something needs approval.

This is an independent example. It is not affiliated with or endorsed by xAI,
and it is not how Grok Bot is built.

## One definition, every bot in data

There is one definition, `agents/bot/agent.ts`. It says what any bot can be.
Every bot is an instance of it:

```
  Maya's workspace (her account)
  ┌──────────────────────────────────────────────────────────────────────┐
  │  Chief             Sales Outbound      Bug Triage        Engineer    │
  │  primary: true     (was "New bot")                                   │
  │  X app                                                               │
  │      │  glove_mesh_send_message, by id      ▲                        │
  │      └──────────────────────────────────────┘── each bot is a row    │
  │  her connected apps on every bot: gmail, sheets, tickets             │
  │  one computer and one skill library for all of them                  │
  └──────────────────────────────────────────────────────────────────────┘
```

- **Name and job** are the instance's `name` and `description`. A new bot has
  neither: it asks what it is for, then calls `take_job`, which writes them.
- **The main bot** is the bot whose `context.primary` is `true`. Its name is
  whatever the person calls it (Maya named hers Chief). It takes everyday
  requests, hands work to the bot whose job fits, and is the one `@bot` on X
  hands tagged posts to.
- **Apps are the account's**, not a bot's. Every bot is created with the apps
  the person connected, and `connect_app` installs a new one on all of them.
- **Teammates** are the other instances in the person's workspace. Bots message
  each other by id over Glove Mesh, which Foundry hosts.
- **A group chat** is a conversation on the bot that hosts it, whose
  `context.group` lists its members.
- **The model** is chosen from the bot's data: a quick one for the main bot, a
  stronger one for the rest.

Making a bot, renaming it or connecting an app is a write. None of it needs a
deploy. The demo account is seeded in `foundry.application.ts` with
`defineAgentInstance` and `createConversation`; the data adapter writes a seed
only when no record has its id, so Maya's changes are kept.

| Grok Bot | Here |
| --- | --- |
| Make a bot, name it and give it a job | `createAgent("bot", botFor(…))` with no job; it asks "what do you want me around for?" and calls `take_job`, a tool that writes its own instance |
| A main bot for everyday requests | The instance with `context.primary: true`; it finds the right bot with `glove_mesh_list_agents` |
| Bots pass work and ownership | `glove_mesh_send_message` by instance id; each handoff names the output under `/workspace`, what is done, evidence, open questions and the next owner; replies come back on their own |
| Group chats of 2–6 bots | A conversation whose data lists its members. The host sends each @-mentioned bot its part, uses `glove_mesh_broadcast` for `@everyone`, and asks the members when nobody is mentioned; a bot with nothing to add replies with nothing |
| Grant access as it asks | `connect_app` asks for approval (the person finishing the provider login), then installs the app on every one of the person's bots |
| One computer for all your bots | `foundryDataEnvironmentPersistence({ scope: "workspace" })`: one working environment per workspace |
| Sign-in handed back to you | `request_sign_in` hands the computer back for SSO, a passkey or a CAPTCHA; the approval is the person signing in. Saved credentials stay in account sessions, out of the model |
| Skills shared across bots | `save_skill` (the person reviews the draft) writes a workspace entry; every bot gets `glove_read_skill` over the library |
| Routines | `glove_foundry_schedule` runs a skill on a cron |
| Comes back when something needs approval | `send_email`, `connect_app`, `save_skill` and `request_sign_in` have `requiresPermission` |
| Tag `@bot` on X | A transmission and a playbook on the main bot that match only its owner's posts; it confirms on X and does the work in the main thread |

## Files

```
agents/bot/
  agent.ts            the one definition: what a bot can be
  prompt.ts           built from the bot's data: name, job, main bot or not, group chat
  tools.ts            take_job, connect_app, save_skill, request_sign_in, the skill library
  skills.ts           the account's skill library, in the workspace
  computer.ts         one computer per person
  bot.memory.ts       each bot's own memory
  apps/               gmail, sheets, tickets, x
  transmissions/  events/  predicates/  actions/  playbook.ts  topology.ts   @bot on X
lib/
  people.ts           an account as data: mainBotFor, botFor, groupChat, the apps
  models.ts           the model per bot, and scripts for offline runs
  ledger.ts  file-store.ts  memory.ts  x-api.ts  authorization.ts  paths.ts
foundry.application.ts  the data adapter, seeded with Maya's main bot and thread
scripts/
  verify.ts           a whole day, offline
  onboard.ts          set up a person on a running Foundry
  x-webhook.ts        X's CRC check and signature, then forward to Foundry
```

## Run it

```bash
pnpm install
pnpm --filter glove-foundry-bot-crew verify   # offline, no keys
cp .env.example .env                          # add ANTHROPIC_API_KEY
pnpm --filter glove-foundry-bot-crew dev      # inspector at http://localhost:4143
pnpm tsx scripts/onboard.ts ada "Ada" 42
```

`verify` runs on the real runtime with scripted models:

1. Maya's account is seeded: her main bot, which she named Chief, with Gmail and Sheets connected.
2. She makes a new bot and tells it its job; it names itself Sales Outbound.
3. Bug Triage asks to connect the ticket tracker; once she approves, all four of her bots have it.
4. Her main bot hands a bug to Bug Triage, which files it and hands the fix to Engineer.
5. An intro email waits for her approval, then sends.
6. A Salesforce sign-in is handed back to her.
7. A workflow she describes becomes a skill (after she reviews it) and a Monday routine.
8. In the Offsite crew group chat, the host asks two bots, and both answer there.
9. Tagging the bot on X reaches her main bot, which confirms there; a stranger's tag starts nothing.

Without `X_BOT_TOKEN`, replies to X go to `.data/x-outbox.jsonl`; emails and
tickets are listed in `.data/ledger.jsonl`.

## Connect X

1. Create an X app with the Account Activity API and a bot account. Set
   `X_BOT_USER_ID`, `X_BOT_HANDLE`, and `X_BOT_TOKEN` (a user token for the bot
   with `tweet.write`).
2. Run `pnpm x-webhook` where X can reach it, with `X_CONSUMER_SECRET`,
   `FOUNDRY_URL` and `FOUNDRY_TOKEN`. Set `X_BEARER_TOKEN` too, so a reply to a
   post includes the post it replied to.
3. Register its URL as the app's webhook and subscribe the bot account.

The forwarder answers X's CRC check, rejects deliveries without a valid
signature, skips the bot's own posts and sends each mention to
`POST /api/transmissions/x-mentions/fire` with `conversationKey: "main"`. Each
main bot's playbook matches only its owner's X user id, so one bot account
serves everyone. A bot someone shared with you can't take tagged requests; only
your own main bot can.

## Deploy on Kuiper

Copy the folder into its own repository and swap the `workspace:*` versions for
published ones. Then:

```bash
kuiper login
kuiper projects create crew && kuiper use crew
kuiper units create crew

kuiper providers add anthropic --key -            # once per organisation
kuiper secrets set X_BOT_TOKEN=-
kuiper env set -u crew CREW_DATA_DIR=/data \
  'ANTHROPIC_API_KEY=${{models.API_KEY}}' \
  'ANTHROPIC_BASE_URL=${{models.ANTHROPIC_BASE_URL}}' \
  'X_BOT_TOKEN=${{secrets.X_BOT_TOKEN}}' \
  X_BOT_USER_ID=… X_BOT_HANDLE=…

kuiper deploy --source . -u crew --wait
kuiper dashboard -u crew --enable                 # inspector login
kuiper logs -u crew -f
```

Model calls go through Kuiper's model gateway, so the Anthropic key stays with
the organisation and every call is counted. Bots, threads, skills, transcripts,
memory and the computers sit on the `/data` disk. A new bot is a new row there,
not a redeploy.

The webhook forwarder runs as a second unit from the same source. It is the
only public way in for X, and it reaches Foundry over the private address:

```bash
kuiper units create x-webhook
kuiper settings -u x-webhook --start-command "pnpm x-webhook" --port 4144
kuiper secrets set X_CONSUMER_SECRET=-
kuiper secrets set FOUNDRY_TOKEN=-
kuiper env set -u x-webhook 'X_CONSUMER_SECRET=${{secrets.X_CONSUMER_SECRET}}' \
  'FOUNDRY_TOKEN=${{secrets.FOUNDRY_TOKEN}}' 'FOUNDRY_URL=${{crew.INTERNAL_URL}}'
kuiper env set -u crew 'FOUNDRY_TOKEN=${{secrets.FOUNDRY_TOKEN}}'
kuiper deploy --source . -u x-webhook --wait
```

For a real computer and browser, swap `agents/bot/computer.ts` for a Kuiper
sandbox per person (`kuiper.sandboxes.create({ image: "kuiper/coding" })`) and
a Kuiper browser with a profile per person, so a sign-in carries over; both from
`@kuiper-sh/sdk`. For email, give the Gmail app a Kuiper inbox with `inboxTools`
from `@kuiper-sh/inbox/glove`.

## Where it differs

- Skills are taught by describing a workflow, not by recording the screen with
  Teach a task.
- There are no Team Bots (one bot shared with a team, a private chat per
  teammate, running on each teammate's computer).
- Approvals are per tool. Grok Bot also runs an auto-review model with
  natural-language "Ask first" and "Allow automatically" rules; see the Dots
  rebuild (`examples/foundry-standing-agents`) for rules kept as data.
- Routines run on schedules only. Grok Bot can also start one from an event,
  which here would be a transmission and a playbook.
- The computer is a Glove working environment (files and scripts) until you swap
  in a Kuiper sandbox and browser per person.
- A direct message to a busy bot starts the next run; in Grok Bot it redirects
  the current turn. Foundry's steering (the client's `steerRun`) does that if your app calls
  it.

## Sources

- [Grok Bot overview](https://cursor.com/docs/grok-bot), [Work with Grok Bot](https://cursor.com/docs/grok-bot/work), [Get started](https://cursor.com/docs/grok-bot/get-started), [Teams](https://cursor.com/docs/grok-bot/teams) and [Security](https://cursor.com/docs/grok-bot/security), Cursor docs
- [Skills and routines](https://docs.x.ai/grok-bot/skills-routines-and-automations) and [Tag @bot on X](https://docs.x.ai/grok-bot/tag-on-x), xAI docs
- [Grok Bot 101](https://x.ai/bot/guides/grok-bot-101), xAI
- [A deep dive into Grok Bot](https://flaviocopes.com/grok-bot/), Flavio Copes
