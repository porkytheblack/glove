# Proactive partner

An agent that looks after one person's inbox, calendar and errands, and
reaches out before they ask, built with Glove Foundry. It follows the shape of
Anthropic's Claude Duet: one ongoing thread, a brief each morning, check-ins
every few hours that stay quiet unless something needs you, its own computer
for long jobs, and nothing sent, paid, signed or deleted without your approval.

This is an independent example. It is not affiliated with or endorsed by
Anthropic.

The partner and its computer are data: `lib/onboarding.ts` describes them in the
person's own workspace, with the person's name, time zone and preferences (when
the brief goes out, which hours are worth a look, what they want to hear about).
`foundry.application.ts` seeds Ada's account with `defineAgentInstance`, and
`scripts/onboard.ts` creates the same records for anyone else. The definitions
in `agents/` say what a partner and a computer can be.

```
   07:30 morning brief      10:00 · 13:00 · 16:00 · 19:00 check-ins
          (schedule)                     (schedule)
              │                              │
   you ──────►├──────────────────────────────┤  one thread per person
  (chat/call) ▼                              ▼
   ┌───────────────────────────────────────────────┐
   │ partner · one per person                       │  read_inbox, read_calendar
   │ memory · skills · guard on everything outbound │  notify_person (push)
   └────┬────────────────────────────┬─────────────┘
        │ send · pay · sign · delete │ glove_mesh_send_message
        ▼                            ▼
   approval: you say yes        computer: files + web, long jobs
```

| Claude Duet | Here |
| --- | --- |
| A morning brief from your connected apps | `morning-brief` schedule, built from the person's `briefAt` and time zone |
| Checks in every few hours, messages you only when needed | `check-in` schedule at the person's `checkInHours`; `notify_person` only for what they `hearAbout`, otherwise `(nothing new)` |
| You set what you hear about and how often | `preferences` on the instance: change them and the next run moves the schedule |
| Flags problems you didn't ask about | The brief looks for clashes, like a client call during a flight, and offers the fix |
| One ongoing thread | One instance and one conversation per person; schedules land in it |
| Hand it work by text or voice | The same agent takes chat or a call (`voiceCall`) |
| Its own virtual machine with a browser | A `computer` agent in the person's workspace, reached over Glove Mesh; it notifies them when a job is done |
| Memory and skills from your account | `defineMemory` on SQLite; `skills/*.md` read with `glove_read_skill` |
| Asks before sending, paying, signing or deleting | `requiresPermission` on `send_message`, `pay_invoice`, `sign_document`, `delete_file` |
| Some actions are off limits even with approval | No tool for trading or moving money between accounts |
| Never sees passwords | Connectors hold credentials; the agent gets tools, not tokens |
| A classifier blocks the most sensitive data | `lib/guard.ts`: card and government ID numbers never leave (in code); health and money details only when asked (a classifier, with `TYPESAFE_API_KEY`) |

Duet says it may misjudge urgency or miss mail that lands between checks. The
same holds here: the model decides what is urgent, and the check-in times are a
choice in `schedules.ts`.

## Files

`agent.ts` only assembles. What each part does lives beside it.

```
agents/
  partner/
    agent.ts             assembly: model per surface, tools, schedules, skills, mesh, call
    schedules.ts         the brief and the check-ins, built from the person's preferences
    actions.ts           send, pay, sign, delete: each waits for approval
    notify.ts            notify_person, the only way to their phone
    call.ts              the voice call
    prompt.ts  personal.memory.ts
  computer/
    agent.ts  prompt.ts  workspace.ts   long jobs in its own files
lib/
  connectors.ts   read_inbox, read_calendar (your code: Gmail, Calendar)
  guard.ts        what may not leave: card and ID numbers in code; health and money details by a classifier
  ledger.ts       what the partner did; where your provider calls go
  skills.ts       skills/*.md as skills
  models.ts       one model per job; scripted with no key
  onboarding.ts   a person's account as data: partner, preferences, computer
skills/           how the person likes things done
fixtures/         a sample inbox and calendar
scripts/
  verify.ts       the whole day, offline
  onboard.ts      connect a person to a running Foundry
```

## Run it

```bash
pnpm install
pnpm --filter glove-foundry-proactive-partner verify   # offline, no keys
cp .env.example .env                                    # add ANTHROPIC_API_KEY
pnpm --filter glove-foundry-proactive-partner dev       # inspector at http://localhost:4147
pnpm tsx scripts/onboard.ts sam "Sam" Europe/London   # Ada is seeded; add someone else
```

`verify` runs a day on the real runtime with a scripted model: the schedules
are on Ada's clock, the brief reaches her phone and flags a call that clashes
with her flight, a quiet check-in sends nothing, a failed payment notifies her,
paying waits for her approval, a card number never leaves (and she is not asked
to approve it), a dashboard is built on the partner's computer and she is told
when it is ready, moving money between accounts is refused, and changing her
brief time moves the schedule.

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
kuiper env set -u partner PARTNER_DATA_DIR=/data \
  'ANTHROPIC_API_KEY=${{models.API_KEY}}' \
  'ANTHROPIC_BASE_URL=${{models.ANTHROPIC_BASE_URL}}' \
  PUSH_URL=https://ntfy.sh/…

kuiper deploy --source . -u partner --wait
kuiper dashboard -u partner --enable              # inspector login
kuiper logs -u partner -f
```

Schedules are stored by Foundry on the `/data` disk, so the brief and check-ins
survive restarts and redeploys. The call room listens on its own port; put it
behind your own proxy if callers connect from outside.

On Kuiper you can swap in managed services:

- **Email.** Give the partner its own address with `kuiper inbox create` and
  `inboxTools` from `@kuiper-sh/inbox/glove` (set
  `INBOX_URL=${{inbox.BASE_URL}}`), and point `read_inbox` at it.
- **The computer.** Replace `agents/computer/workspace.ts` with a sandbox per
  person (`kuiper.sandboxes.create({ image: "kuiper/coding" })`) and a browser
  (`kuiper.browsers.create()`), both from `@kuiper-sh/sdk`.
