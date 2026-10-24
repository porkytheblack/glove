# Bot crew

AI teammates you give real work to, built with Glove Foundry. It follows the
shape of xAI's Grok Bot: a person makes bots and tells each one its job, a Chief
runs the others, bots hand work to each other and share group chats, they share
one computer, they learn skills and run them as routines, and they come back
only when something needs approval.

This is an independent example. It is not affiliated with or endorsed by xAI.

## One definition, every bot in data

There is one definition, `agents/bot/agent.ts`. It says what a bot can be. Every
bot is an instance of it, created by the application:

```
  Maya's workspace (her team)
  ┌──────────────────────────────────────────────────────────────────────┐
  │  Chief           Sales Outbound      Bug Triage        Engineer      │
  │  role: chief     gmail, sheets       tickets           (computer)     │
  │  X app                                                               │
  │      │  glove_mesh_send_message, by id      ▲                        │
  │      └──────────────────────────────────────┘── each bot is a row    │
  │  one computer and one skill library for all of them                  │
  └──────────────────────────────────────────────────────────────────────┘
```

- **Name and job** are the instance's `name` and `description`. A new bot has
  neither: it asks what it is for, then calls `take_job`, which writes them.
- **Apps** are installations on the instance: a bot without Gmail has no mail
  tools at all.
- **The Chief** is a bot whose `context.role` is `"chief"`.
- **Teammates** are the other instances in the person's workspace. Bots message
  each other by id over Glove Mesh, which Foundry hosts.
- **A group chat** is a conversation on the Chief whose `context.group` lists
  its members.
- **The model** is chosen from the bot's data: a quick one for the Chief, a
  stronger one for the rest.

Adding a bot, renaming one or giving it Gmail is a write. Nothing here needs a
deploy for that.

| Grok Bot | Here |
| --- | --- |
| Make a bot and tell it its job | `createAgent("bot", …)` with no job; it calls `take_job`, a tool that writes its own instance |
| A Chief that runs the others | A bot with `context.role: "chief"`; it finds bots with `glove_mesh_list_agents` |
| Bots pass work to each other | `glove_mesh_send_message` by instance id; replies and questions come back on their own |
| Group chats | A conversation whose data lists its members; the Chief sends each @-mentioned bot its part |
| Sign in to your tools | `request_sign_in` hands the browser back; approving it is the person signing in |
| A computer the bots share | One working environment per workspace (`computer.ts`) |
| Show it once, it saves a routine | `save_skill` (the person reviews the draft) into the team's library; `glove_foundry_schedule` runs it |
| Comes back only for approval | `send_email` has `requiresPermission: true` |
| Tag the bot on X | A transmission and a playbook on the Chief that match only its owner's posts |

## Files

```
agents/bot/
  agent.ts            the one definition: what a bot can be
  prompt.ts           built from the bot's data: name, job, Chief or not, group chat
  tools.ts            take_job, save_skill, request_sign_in: each writes data
  skills.ts           the team's skill library, in the workspace
  computer.ts         one computer per person
  bot.memory.ts       each bot's own memory
  apps/               gmail, sheets, tickets, x: installed per bot
  transmissions/  events/  predicates/  actions/  playbook.ts  topology.ts   @bot on X
lib/
  people.ts           an account as data: chiefFor, botFor, groupChat
  models.ts           the model per bot, and scripts for offline runs
  data.ts  ledger.ts  file-store.ts  memory.ts  x-api.ts  authorization.ts  paths.ts
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
pnpm tsx scripts/onboard.ts maya "Maya" 42
```

`verify` runs on the real runtime with scripted models:

1. Maya's account starts with a Chief.
2. She opens a new bot and tells it its job; it names itself Sales Outbound.
3. The Chief hands a bug to Bug Triage, which files it and hands the fix to Engineer.
4. An intro email waits for her approval, then sends.
5. A Salesforce sign-in is handed back to her.
6. A workflow she describes becomes a skill (after she reviews it) and a Monday routine.
7. In the Offsite crew group chat, the Chief asks two bots, and both answer there.
8. Tagging the bot on X reaches her Chief, which confirms there; a stranger's tag starts nothing.

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
Chief's playbook matches only its owner's X user id, so one bot account serves
everyone.

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
memory and the computers sit on the `/data` disk.

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
