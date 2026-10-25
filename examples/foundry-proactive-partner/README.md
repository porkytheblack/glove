# Proactive partner

An agent that looks after one person's inbox, calendar and errands, and
reaches out before they ask, built with Glove Foundry. It follows the shape of
Anthropic's Claude Duet: it works in the apps you connect (here Gmail and
Google Calendar), keeps one ongoing thread, sends a brief each morning and
checks in every few hours, stays quiet unless something needs you, has its own
computer for long jobs, and sends, pays, signs or deletes nothing without your
approval.

This is an independent example. It is not affiliated with or endorsed by
Anthropic.

The partner and its computer are data: `lib/onboarding.ts` describes them in the
person's own workspace, with the person's name, time zone and preferences (when
the brief goes out, which hours are worth a look, what they want to hear about).
`foundry.application.ts` seeds Ada's account with `defineAgentInstance`, and
`scripts/onboard.ts` creates the same records for anyone else. The definitions
in `agents/` say what a partner and a computer can be.

```
   07:30 morning brief      10:00 · 13:00 · 16:00 · 19:00 check-ins      new mail
          (schedule)                     (schedule)                  (Gmail watch)
              │                              │                             │
   you ──────►├──────────────────────────────┼─────────────────────────────┤  one thread per person
  (chat/call) ▼                              ▼                             ▼
   ┌───────────────────────────────────────────────────────────────────────┐
   │ partner · one per person                                               │
   │ gmail.search_threads(…), calendar.list_events(…) in code               │  notify_person (push)
   │ memory · skills · guard on every email                                 │
   └────┬────────────────────────────────────────┬─────────────────────────┘
        │ email · pay · sign · delete             │ glove_mesh_send_message
        ▼                                         ▼
   approval: you say yes                     computer: files + web, long jobs
```

## Connected apps

Gmail and Google Calendar are Foundry apps installed on the partner with the
person's accounts. They work exactly as in the bot crew example:

- **Reads come from Google's MCP servers** (Gmail and Calendar), opened with the
  installation's account. The partner reads both in code: a brief is one
  program over `gmail.search_threads` and `calendar.list_events`.
- **Email goes out through the Gmail transmission**, delivered by Foundry inside
  the account session after the person approves the exact message. The partner
  wraps that send in its guard (`agents/partner/send.ts`): a message with a card
  or government ID number is refused without asking, and health or money details
  leave only when the person's own message asked.
- **New mail arrives as it lands.** The `gmail-watch` connection renews Gmail's
  watch, pulls the notifications and passes each message into the one thread,
  where the partner decides whether it needs the person now.
- **Calendar is an app that is only an MCP server.** Creating or moving an event
  asks first unless the person always allows it.

Accounts and tokens are yours (`lib/accounts.ts`); Foundry reads accounts
through your directory and asks `accountSessions` for an operation, never for a
token. `pnpm connect <person> gmail|calendar` runs Google's sign-in and connects
the account (`lib/connect.ts`).

| Claude Duet | Here |
| --- | --- |
| Connects to your apps | Gmail and Google Calendar apps installed with the person's accounts: Google's MCP servers for reads, the Gmail transmission for sending, a connection for new mail |
| A morning brief from your connected apps | `morning-brief` schedule, built from the person's `briefAt` and time zone; reads both apps in one program |
| Checks in every few hours, messages you only when needed | `check-in` schedule at the person's `checkInHours`; `notify_person` only for what they `hearAbout`, otherwise `(nothing new)` |
| You set what you hear about and how often | `preferences` on the instance: change them and the next run moves the schedule |
| Flags problems you didn't ask about | The brief looks for clashes, like a client call during a flight, and offers the fix |
| One ongoing thread | One instance and one conversation per person; schedules land in it |
| Hand it work by text or voice | The same agent takes chat or a call (`voiceCall`) |
| Its own virtual machine with a browser | A `computer` agent in the person's workspace, reached over Glove Mesh; it notifies them when a job is done |
| Memory and skills from your account | `defineMemory` on SQLite; `skills/*.md` read with `glove_read_skill` |
| Asks before sending, paying, signing or deleting | Gmail's send, `pay_invoice`, `sign_document` and `delete_file` wait for approval |
| Some actions are off limits even with approval | No tool for trading or moving money between accounts |
| Never sees passwords | Tokens stay in your store; apps and sends ask `accountSessions` for an operation |
| A classifier blocks the most sensitive data | `lib/guard.ts`: card and government ID numbers never leave (in code); health and money details only when asked (a classifier, with `TYPESAFE_API_KEY`) |

Duet says it may misjudge urgency. The same holds here: the model decides what
is urgent. New mail reaches it as it arrives; the check-ins cover everything
else, at times that are a choice in `schedules.ts`.

## Files

`agent.ts` only assembles. What each part does lives beside it.

```
agents/
  partner/
    agent.ts             assembly: apps, REPL, model per surface, schedules, playbook, guard, mesh, call
    apps/                gmail (MCP + send + watch), calendar (MCP)
    transmissions/  connections/  events/  actions/  playbook.ts   new mail into the thread
    send.ts              Gmail's send behind the guard
    schedules.ts         the brief and the check-ins, built from the person's preferences
    actions.ts           pay, sign, delete: each waits for approval
    notify.ts            notify_person, the only way to their phone
    call.ts              the voice call
    prompt.ts  personal.memory.ts
  computer/
    agent.ts  prompt.ts  workspace.ts   long jobs in its own files
lib/
  accounts.ts     your account store: accounts, tokens, the directory, accountSessions
  connect.ts      connecting an app: account, routes, installation, binding
  oauth.ts  google.ts  mcp-servers.ts  tool-policy.ts
  guard.ts        what may not leave: card and ID numbers in code; health and money details by a classifier
  ledger.ts       what the partner did
  skills.ts       skills/*.md as skills
  models.ts       one model per job; scripted with no key
  onboarding.ts   a person's account as data: partner, preferences, computer
demo/             local Gmail and Calendar MCP servers for sample accounts
skills/           how the person likes things done
fixtures/         a sample inbox and calendar
scripts/
  verify.ts       the whole day, offline
  onboard.ts      sign a person up on a running Foundry
  connect.ts      connect their Gmail or Calendar through Google's sign-in
```

## Run it

```bash
pnpm install
pnpm --filter glove-foundry-proactive-partner verify   # offline, no keys
cp .env.example .env                                    # add ANTHROPIC_API_KEY
pnpm --filter glove-foundry-proactive-partner dev       # inspector at http://localhost:4147
pnpm onboard sam "Sam" Europe/London                    # Ada is seeded; add someone else
pnpm connect sam gmail                                  # needs GOOGLE_CLIENT_ID and friends
```

`verify` runs a day on the real runtime with a scripted model and Ada's sample
accounts: the schedules are on Ada's clock and her Gmail is watched, the brief
reads her inbox and calendar in code and flags a call that clashes with her
flight, a quiet check-in sends nothing, a failed payment arrives in her Gmail
and she is told at once, paying waits for her approval, a reply to Leo goes from
her Gmail in his thread once she approves it, a card number never leaves (and
she is not asked to approve it), a dashboard is built on the partner's computer
and she is told when it is ready, moving money between accounts is refused, and
changing her brief time moves the schedule.

Check-ins run on their schedule. To see one sooner while you try it, set the
cron in `schedules.ts` to `*/5 * * * *`. Without `PUSH_URL`, notifications are written to
`.data/ledger.jsonl`. Point `PUSH_URL` at `https://ntfy.sh/<your topic>` to get
them on your phone.

The call works as in the layered assistant example: send a message whose
payload is `{ call: { port, token } }`, then connect the page to
`ws://…:port/call?token=…`. Set `OPENAI_API_KEY` for speech.

## Deploy on Kuiper

Copy the folder into its own repository and swap the `workspace:*` versions for
published ones. Then:

```bash
kuiper login
kuiper projects create partner && kuiper use partner
kuiper units create partner

kuiper providers add anthropic --key -            # once per organisation
kuiper secrets set GOOGLE_CLIENT_SECRET=- GOOGLE_SERVICE_ACCOUNT_JSON=-
kuiper env set -u partner PARTNER_DATA_DIR=/data \
  'ANTHROPIC_API_KEY=${{models.API_KEY}}' \
  'ANTHROPIC_BASE_URL=${{models.ANTHROPIC_BASE_URL}}' \
  PUSH_URL=https://ntfy.sh/… \
  GOOGLE_CLIENT_ID=… 'GOOGLE_CLIENT_SECRET=${{secrets.GOOGLE_CLIENT_SECRET}}' \
  GMAIL_PUBSUB_TOPIC=… GMAIL_PUBSUB_SUBSCRIPTION=… \
  'GOOGLE_SERVICE_ACCOUNT_JSON=${{secrets.GOOGLE_SERVICE_ACCOUNT_JSON}}'

kuiper deploy --source . -u partner --wait
kuiper dashboard -u partner --enable              # inspector login
kuiper logs -u partner -f
```

Schedules, accounts, tokens, routes and bindings are on the `/data` disk, so
the brief, the check-ins and connected apps survive restarts and redeploys. New
mail needs nothing public: the Gmail watch pulls its subscription from inside
the unit. The call room listens on its own port; put it
behind your own proxy if callers connect from outside.

On Kuiper you can swap in a managed computer:

- **The computer.** Replace `agents/computer/workspace.ts` with a sandbox per
  person (`kuiper.sandboxes.create({ image: "kuiper/coding" })`) and a browser
  (`kuiper.browsers.create()`), both from `@kuiper-sh/sdk`.
