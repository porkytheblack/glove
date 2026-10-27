# Personal agent

A personal agent that does the work for one person, built with Glove Foundry.
It follows the shape of Meta's Muse:

- the person talks to it in an app or on WhatsApp, like messaging someone, and
  gives it a name and a way of talking;
- it works across the apps they connect, at the access they choose;
- it has a browser of its own for the web: a real Chrome on Kuiper;
- a separate Sentinel decides what may leave that browser;
- the person signs in to sites themselves, in a live view of that browser, and
  it pays with one-time cards it never sees;
- it turns a goal into a plan, and keeps going after they close the app;
- it remembers what they tell it, suggests things from it, and forgets on
  request;
- it keeps a log of everything it did and plans to do.

Meta Superintelligence Labs announced Muse on 8 September 2026; it runs on
Meta's Muse Spark model. Here Muse runs on Claude Sonnet 5.5 and the Sentinel
on Claude Haiku 5.5, through Kuiper's model gateway once deployed
(`MUSE_MODEL` and `SENTINEL_MODEL` change them).

This is an independent example. It is not affiliated with or endorsed by Meta,
and it is not how Muse is built.

```
   the app ─────┐                  WhatsApp ──► the web app's /webhooks/whatsapp ──► whatsapp-in
                ▼                                                                    │
   ┌───────────────────────────────── Muse · one per person ─────────────────────────▼──┐
   │ conversations: app, whatsapp · one memory                                          │
   │ gmail.search_threads(…), calendar.list_events(…) in code · at the access she chose │
   │ buy (one-time card) · Gmail send · WhatsApp answer  ── each asks or is hers only   │
   └────────────┬───────────────────────────────────────────────────────────┬──────────┘
                │ execute_browser (glove-execution/kuiper)                   │ every tool call
                ▼                                                            ▼
   her browser on Kuiper ── every request ──► Sentinel: allow · block · ask her
     (her profile: logins)                                             the log (subscriber)
        │  sign in? browser.handOff ──► the live view, to her on WhatsApp
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
  The web app's `/webhooks/whatsapp` route does both and forwards each text
  message to Foundry (`lib/whatsapp-webhook.ts`).

## Apps at the access she chooses

Gmail and Google Calendar are Foundry apps installed with Rosa's accounts, as
in the other rebuilds: Google's MCP servers for reads, run as functions in
code; the Gmail transmission for sending; a Gmail watch for new mail. What is
new is the access she chooses for each app, kept as the installation's
config:

- **read**: the app's tool policy hides every tool that changes something, and
  `configure` removes Gmail's send tool, so Muse cannot even try. The send
  binding is off, so Foundry would refuse the delivery anyway.
- **act**: drafting runs; sending an email asks her every time; creating or
  moving events asks unless she always allows it.

`setAccess` changes it and `disconnect` takes an app away (`lib/connect.ts`).
Both are writes, not deploys. `pnpm connect <person> gmail read|act` asks
Google only for the scopes that access needs.

## Its own browser on Kuiper, and the Sentinel

Muse's browser is a real Chrome from [Kuiper](https://kuiper.sh), one per
person, mounted in `configure` with `glove-execution/kuiper` and the Kuiper SDK
(`agents/muse/browser.ts`). Muse drives it in code with `execute_browser`:
open, navigate, read the page, fill and click, check the result, all in one
script.

- **It lasts between runs.** A Kuiper session belongs to the project, not the
  process, so the instance keeps its ID (`context.browser.sessionId`) and the
  next run reconnects to the same browser. A session nobody uses hibernates
  on its own (`inactivityTimeout` with `onInactive: "hibernate"`), and
  connecting resumes it.
- **Her logins are a profile.** Sessions start from her Kuiper profile
  (`context.browser.profileId`) and save to it when Muse closes them.
- **She can watch it.** When Muse opens a browser, host code keeps that
  session's view-only live view (`debugUrl`) on the instance
  (`context.browser.watchUrl`) for her app's Watch screen. The prompt never reads
  it. Sessions are also recorded, so your app can show her a replay
  (`session.recording()`) once one hibernates or ends. Kuiper's dashboard is
  yours, the operator's, not hers.
- **It says it is an agent.** Its tabs send the browser's own user agent with
  `MuseRebuild/1.0 (+…)` added (`AGENT_TOKEN` in `lib/kuiper.ts`), while Muse
  is connected. Put your agent's name there. It never claims to be another
  browser.

**The Sentinel** (`agents/muse/sentinel.ts`) is the browser's guard.
`glove-execution/kuiper` calls it for every request the browser makes while
Muse is connected, outside the page and outside Muse's model, before anything
leaves:

- A page loading, and anything that could write (a form post, a page's own
  POST, a WebSocket), gets a decision. A page's images, scripts and styles only
  get the quick checks, so one page doesn't cost dozens of decisions.
- It is kept apart from Muse. It never sees Muse's conversation, its reasoning
  or the pages it read, so a page that tells Muse what to do cannot talk the
  Sentinel round.
- It sees only the request, what the person asked for in this run, and the
  sites they allowed.
- Rules in code come first: a site she blocked, or personal details in a URL
  bound for a site she never allowed.
- Then its own small model answers one typed question (allow, ask or block)
  through `glove-classifier`'s `llmClassifier`. Without a model, reads pass and
  writes ask.
- When it says "ask", Muse calls `request_access`. That tool waits for her
  approval only when the Sentinel asked, and her approval is the only way a
  site is added. Reading a site and sending to it are separate grants
  (`sentinel.read` and `sentinel.write`), and the approval says which one she
  gives; it must match what the Sentinel stopped. Letting Muse read a site
  doesn't let it post there, and the Sentinel's model never lets a send through
  to a site without a write grant: that asks her. A blocked request stays
  blocked.

**Signing in is hers.** When a site wants her signed in (or shows a CAPTCHA
she chooses to do), Muse calls `browser.handOff`:
- Host code sends her Kuiper's live view of that browser on WhatsApp, and keeps
  it host-side (`lib/handoffs.ts`) for the web app's "Take over to sign in"
  until the session closes. The link never enters Muse's context.
- She signs in there herself. Muse never sees her password.
- The cookies stay in the browser, and in her profile once Muse closes it.

**Turned away, it stops.** Amazon barred Meta's Muse, saying it didn't
identify itself. Here, when a site says it doesn't allow automated agents, Muse
stops and tells her. It doesn't look for another way.

## Approvals, paying, long work, memory and the log

- **Sending and paying wait for her.** Gmail's send asks for each email.
  `buy` asks for each purchase, with the checkout open in Muse's browser
  (`lib/payments.ts`):
  - It gets a one-time card for that merchant and amount.
  - Host code types the card into the checkout, in a tab Muse never sees, and
    submits it. The Sentinel lets that checkout through for this run only.
  - The card number never reaches Muse.

  Muse checks out with Stripe's Link, whose agent wallet issues single-use
  cards. Any issuer of single-use virtual cards fits here. This example ships
  only a stand-in issuer for `verify`. Put yours in `issuer()`; until you do,
  `buy` says it can't pay.
- **A goal becomes a plan.** Plans are Foundry goals (`defineGoals`, in
  `lib/memory.ts`) at instance scope, so a plan made on WhatsApp is the same
  plan in the app: one goal per plan, one item per step. Muse marks steps done
  with `glove_goal_update` and revises the plan when things change.
- **Long work keeps going.** Muse sets its own checks with
  `glove_foundry_schedule` or `glove_foundry_sleep` and messages her on
  WhatsApp when something changes. New mail that changes a plan reaches her
  the same way.
- **It suggests.** The prompt asks Muse to suggest something it remembers when
  it would help, and a daily `suggest` schedule on the instance runs a short
  pass over what it knows and the plans it keeps.
- **Forget.** `glove_context_set` keeps a fact; `glove_context_unset` forgets
  it when she asks. Forgetting removes the fact from memory, and the log never
  held it: for memory tools it records only that memory changed. The messages where it came up stay:
  hers and Muse's in the conversation, and what Muse sent in the log.
- **Its name and style are hers.** `agentName`, `avatar` and `style` on the
  person (`lib/people.ts`) become the instance's name and `context.persona`.
  The prompt uses the name and the style; your app shows the avatar.
- **The log** (`lib/activity.ts`). What Muse did is written from Foundry's
  side of the run, so the model cannot leave anything out:
  - a subscriber records every tool call and how it ended;
  - the Sentinel records every decision;
  - the browser's host code records each browser it opens and each hand-off.

  What it plans is Foundry's own data: its schedules and wake-ups, the steps
  of its plans not done yet, and the approvals waiting on her. `logFor` puts
  them together for your app's Activity page.

| Meta Muse | Here |
| --- | --- |
| Talk to it in the app or on WhatsApp, like messaging a person | One instance, conversations `app` and `whatsapp`, one memory; WhatsApp is a Foundry app with a transmission each way |
| You set its name, avatar and communication style | `agentName`, `avatar`, `style` on the person: the instance's name and `context.persona`, read by the prompt |
| Connects email, calendar, banks through Plaid, and partners like Shopify, Walmart and Instacart | Gmail and Google Calendar as Foundry apps, at the access she chooses: `read` hides every write and turns off the send binding; `act` asks first. Here she can also change access or disconnect at any time (`setAccess`, `disconnect`, both writes) |
| A dedicated, isolated cloud VM per person (Muse Secure VM), with a browser you can watch | A real Chrome per person on Kuiper (`glove-execution/kuiper`), kept between runs, hibernating when idle, recorded; its view-only live view kept for her app |
| Nothing reaches the internet unless the Sentinel approves it; the Sentinel asks you when needed | The browser's guard runs the Sentinel on every request the browser makes; "ask" goes to the person through `request_access` |
| Read and write access are granted separately per app | Per app, `read` or `act`; in the browser, the Sentinel's `read` and `write` lists per site |
| The Sentinel is isolated from Muse | It never sees Muse's conversation or what it read; its own model, no tools |
| It can't see your passwords or payment methods; credentials for connected services are stored in its VM (reusing your logins through 1Password is "coming soon") | She signs in herself in Kuiper's live view (`browser.handOff`), and her Kuiper profile keeps the logins; app tokens stay in your account store (`lib/accounts.ts`), out of Muse's reach; host code types the card |
| Asks before sending email or buying | Gmail's send and `buy` have `requiresPermission` |
| Checks out with Stripe's Link, whose agent wallet issues single-use cards | `buy` gets a one-time card and host code types it into the checkout, in a tab Muse never sees; Muse sees the last four digits |
| Turns a goal into a personal plan | Foundry goals at instance scope, one goal per plan; their open steps are in the log |
| Keeps working after you close the app, comes back when something changes | `glove_foundry_schedule` / `glove_foundry_sleep`; new mail through the Gmail watch; WhatsApp to tell her |
| Remembers what matters, suggests unprompted, forgets when told | `defineMemory`; a prompt line and a daily `suggest` schedule; `glove_context_set` / `glove_context_unset`, which the log records without their content |
| A complete log of everything it has done and plans to do | A subscriber and the Sentinel write what it did; schedules, open plan steps and pending approvals are what it plans |

## Files

`agent.ts` only assembles. What each part does lives beside it.

```
agents/muse/
  agent.ts            assembly: apps, model, memory, plans, tools, REPL, browser, playbooks, schedule, log, accounts
  apps/               gmail (MCP + send + watch), calendar (MCP), whatsapp (in + out)
  transmissions/      gmail, whatsapp
  topology.ts         Muse's WhatsApp number and the shared route in
  playbook.ts         WhatsApp from the person; new mail
  sentinel.ts         what may leave the browser, and request_access
  browser.ts          the browser on Kuiper: profile, kept session, guard, hand-off
  tools.ts            buy, request_access; the access rule for Gmail's send
  prompt.ts  muse.memory.ts  subscribers/activity.subscriber.ts
  connections/  events/  actions/  predicates/
lib/
  accounts.ts         your account store: accounts, tokens, the directory, accountSessions
  connect.ts          connecting an app at an access level; WhatsApp per person
  kuiper.ts           the Kuiper client: models and browsers, one key; the agent's name for sites
  memory.ts           memory and plans, a namespace per person
  payments.ts         one-time cards, typed into the checkout
  activity.ts         the log: done and planned; plans for the app
  handoffs.ts         a browser handed to the person, kept host-side for the app until its session closes
  whatsapp.ts         Meta's Cloud API
  whatsapp-webhook.ts Meta's webhook: handshake, signature, forward to Foundry
  oauth.ts  google.ts  mcp-servers.ts  people.ts  models.ts
  host.ts             what the web app's server loads from lib, after discovery
app/                  the web app (Next.js): Chat, Watch, Plans, You, Connections, sign-in;
                      /webhooks/whatsapp for Meta
demo/                 local Gmail and Calendar MCP servers; a stand-in for Kuiper's browser API, and sample sites
scripts/
  verify.ts           a day, offline
  web-smoke.ts        the web app in Chromium, offline
  start.mjs  dev.mjs  Foundry and the web app together
  invite.ts           a sign-in link for one person
  onboard.ts          sign a person up on a running Foundry
  connect.ts          connect their Gmail or Calendar at an access level
  whatsapp-webhook.ts the same webhook on its own port, for local runs
```

## Run it

```bash
pnpm install
pnpm --filter glove-foundry-personal-agent verify   # offline, no keys; a local Chromium
cp .env.example .env                                 # add GATEWAY_KEY (or ANTHROPIC_API_KEY, or OPENROUTER_API_KEY)
pnpm --filter glove-foundry-personal-agent dev       # the app at http://localhost:3000, inspector at :4149
pnpm onboard sam "Sam" 15550109999 Juniper          # Rosa is seeded; add someone else, naming their agent
pnpm connect sam gmail read                          # needs GOOGLE_CLIENT_ID and friends
```

`verify` runs a day on the real runtime with a scripted model and Rosa's sample
accounts. Kuiper's browser API is stood in for by `demo/kuiper.ts`: each
session is a Chromium on your machine, browsing sample sites, and the SDK and
`glove-execution/kuiper` run unchanged against it. It needs Playwright's
Chromium (`npx playwright-core install chromium`), or set `MUSE_CHROMIUM` to a
Chromium binary.
The scripted model answers at once; set `MUSE_DEMO_PACE_MS=700` to give it a
model's pause, so a run's timings in the inspector look like a real one.

1. Her Muse is seeded with Gmail and Calendar read only, and WhatsApp on her number.
2. It reads her calendar and inbox in one program.
3. Asked to email Leo, it can't: Gmail is read only, so there is no send tool. She gives it send access, and it sends once she approves.
4. On WhatsApp she tells it Priya is vegetarian, and in the app it knows. A stranger's WhatsApp message wakes nothing.
5. It books dinner in its own browser:
   - the Sentinel lets it read the restaurant's page;
   - the page hides an instruction to send her email address to another site, and the Sentinel blocks it;
   - the Sentinel asks her about the booking, and she allows it;
   - the site wants her signed in, so Muse hands her the browser's live view on WhatsApp;
   - she signs in there, says so, and it books;
   - her profile keeps the login: a new browser from it is signed in;
   - her app has the browser's view-only live view, the sites saw its agent
     token, and a site she only lets it read can't be posted to.
6. It pays for groceries at the checkout with a one-time card once she approves.
7. It turns her half marathon into a plan, and sets itself to watch a train fare every 6 hours.
8. New mail that moves the dinner reaches her on WhatsApp.
9. She asks it to forget Priya, and it does. The log says memory changed, not what it kept.
10. Its log shows what it did and what it plans: the fare watch, the daily
    suggestion pass and the plan's open steps. She disconnects Calendar.

The run also checks that her password and the card number appear nowhere in
Muse's data, and the live view link only in the WhatsApp message to her. Sample sends and purchases are listed in `.data/ledger.jsonl`, and
the log is in `.data/activity.jsonl`.

## The web app

Rosa's side of it, in `app/`: a phone-first Next.js app that runs next to
Foundry in the same unit and shares its `/data`. On a desktop it is the same
phone-width column, centred. It is built on the shared kit in
`examples/foundry-web-kit`.

- **Chat.** Her `app` conversation with Muse. Replies stream in as they are
  written, with the tools it used above each one. What waits for her shows
  inline: the Sentinel's `request_access` as its own card (the site, whether
  Muse would read it or send to it, and why: "Allow sending here" or "Not
  now"), and Gmail's send and `buy` as approval cards with the email or the
  purchase. Approvals asked on WhatsApp show here too. When a site wants her
  signed in, a note links to Watch. WhatsApp is the other conversation;
  the app shows that it exists, not its messages.
- **Watch.** Muse's browser, from the view-only live view on the instance
  (`context.browser.watchUrl`), embedded only when it is https, with the page
  it is on. When a hand-off waits, "Take over to sign in" goes to
  `/api/watch/take-over`, which redirects the signed-in person, and only
  them, to Kuiper's interactive live view kept by `lib/handoffs.ts`. No page
  or API response holds that link, and it is cleared when the session closes.
  WhatsApp still gets it too.
- **Plans.** Her plans and their steps (Foundry goals at instance scope), and
  the log: what is planned (its checks and schedules, next steps, what waits
  for her) and what it did today, as plain lines. Session ids and tool input
  stay on the server.
- **You.** Its name, colour and way of talking, written to the instance
  (`name` and `context.persona`) with the rest of its data kept. What it
  remembers, each with Forget: the same removal `glove_context_unset` makes,
  in her memory only. Sign out.
- **Connections.** Read or Act per app (`setAccess`), or Disconnect; the
  account each holds; her WhatsApp number; the sites the Sentinel knows from
  `context.sentinel` (Read, Read · Send, Blocked).

The browser only talks to the app's server. That server holds
`FOUNDRY_TOKEN`, calls Foundry on loopback and loads `lib/host.ts` for the
rest (memory, plans, the log, the hand-off). Every API route checks the
session, then that the person's workspace owns the run, approval or memory
entry it names, and answers 404 otherwise. Live updates are server-sent events
at `/api/runs/<id>/live`, which pass on only text, tool names, approvals and
the run's start and end.

```bash
pnpm --filter glove-foundry-personal-agent dev          # Foundry dev + next dev on :3000
pnpm --filter glove-foundry-personal-agent build        # next build
pnpm --filter glove-foundry-personal-agent start        # Foundry on 127.0.0.1:4141 + next start on $PORT
pnpm --filter glove-foundry-personal-agent web-smoke    # offline, in Chromium
```

**Signing in.** `pnpm invite rosa` prints `<WEB_URL>/signin?t=…`, a link for
Rosa that works for 7 days. Its token is HMAC-SHA256 with
`WEB_SESSION_SECRET` over her id and the expiry. Opening it sets an HttpOnly
`session` cookie for 30 days (Secure over https); her workspace is her id.
With no `WEB_SESSION_SECRET` in development, the sign-in page lists the
people with a Muse (Rosa, and anyone `pnpm onboard` added); in production the
secret is required.

`web-smoke` builds if needed and starts the unit with the scripted model
(`MUSE_DEMO=1`) and the Kuiper stand-in, then signs Rosa in through an invite
link. Her hello streams in; she asks for the Bistro Luna booking and allows
the Sentinel's send; she takes over from Watch, signs in, and Muse books; she
forgets something from You, renames Muse, gives Gmail send access, and finds
her plan and log in Plans. Sam's run, an approval id and Sam's memory entry
answer 404 to her. Set `WEB_SMOKE_SHOTS=<dir>` to save each screen.

## Try it: the demo connectors

Set `DEMO_CONNECTORS=1` and the web app serves a mock WhatsApp and a mock
Gmail, with a **Try it** tab at `/demo`. They stand in for Meta and Google, so
the whole path runs with no real accounts:

1. The page signs a WhatsApp delivery the way Meta does
   (`X-Hub-Signature-256`) and posts it to the app's own `/webhooks/whatsapp`
   at `WEB_URL`, through the same edge a real webhook comes in by.
2. The webhook checks the signature, answers 200 and forwards the message to
   Foundry's `whatsapp` route. A message from Rosa's number starts a run; a
   stranger's matches no playbook, so nothing runs.
3. Muse answers through the WhatsApp transmission. The send goes to the mock
   Graph API (`app/mock/whatsapp`), which checks the token and puts the reply
   on the page.
4. Mail goes to `/webhooks/mail`, which exists only in this mode. It lands in
   the sample Gmail and fires the account's inbound route, as the Gmail watch
   would for a real account.

Every hop goes in `<MUSE_DATA_DIR>/demo-connectors.jsonl`, and the page shows
it as a delivery log. `scripts/demo-connectors.mjs` derives the mock secrets
from `WEB_SESSION_SECRET` and points `WHATSAPP_GRAPH_URL` at the mock. It
overrides real values, so leave it off when you connect real accounts. A
person can send at most 30 an hour, since each one starts a model run.

## Connect real accounts and WhatsApp

- **Gmail and Calendar.** Create a Google OAuth client with the Gmail, Gmail
  MCP, Calendar and Calendar MCP APIs enabled and
  `http://127.0.0.1:53683/callback` as a redirect URI. For new mail, create a
  Pub/Sub topic that `gmail-api-push@system.gserviceaccount.com` may publish
  to, a pull subscription, and a service account that may pull. Set the
  `GOOGLE_*` and `GMAIL_PUBSUB_*` variables, then
  `pnpm connect <person> gmail read`.
- **WhatsApp.** In Meta's developer app, add WhatsApp and note the phone
  number id; make a system user token. Register `<WEB_URL>/webhooks/whatsapp`
  as the webhook with your `WHATSAPP_VERIFY_TOKEN`. Set
  `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TOKEN`, `WHATSAPP_APP_SECRET` and
  `WHATSAPP_VERIFY_TOKEN`. Locally, `pnpm whatsapp-webhook` serves the same
  webhook on port 4150 for a tunnel.
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
kuiper secrets set GOOGLE_CLIENT_SECRET=- GOOGLE_SERVICE_ACCOUNT_JSON=- FOUNDRY_TOKEN=- WEB_SESSION_SECRET=-
kuiper secrets set WHATSAPP_TOKEN=- WHATSAPP_APP_SECRET=- WHATSAPP_VERIFY_TOKEN=-
kuiper env set -u muse MUSE_DATA_DIR=/data \
  'WEB_SESSION_SECRET=${{secrets.WEB_SESSION_SECRET}}' WEB_URL=https://… \
  'GATEWAY_KEY=${{models.API_KEY}}' \
  'BROWSERS_URL=${{browsers.BASE_URL}}' \
  GOOGLE_CLIENT_ID=… 'GOOGLE_CLIENT_SECRET=${{secrets.GOOGLE_CLIENT_SECRET}}' \
  GMAIL_PUBSUB_TOPIC=… GMAIL_PUBSUB_SUBSCRIPTION=… \
  'GOOGLE_SERVICE_ACCOUNT_JSON=${{secrets.GOOGLE_SERVICE_ACCOUNT_JSON}}' \
  WHATSAPP_PHONE_NUMBER_ID=… 'WHATSAPP_TOKEN=${{secrets.WHATSAPP_TOKEN}}' \
  'WHATSAPP_APP_SECRET=${{secrets.WHATSAPP_APP_SECRET}}' \
  'WHATSAPP_VERIFY_TOKEN=${{secrets.WHATSAPP_VERIFY_TOKEN}}' \
  'FOUNDRY_TOKEN=${{secrets.FOUNDRY_TOKEN}}'

kuiper deploy --source . -u muse --wait
kuiper logs -u muse -f
```

`kuiper.json` starts `scripts/start.mjs` under `tini` and makes port 3000
public: the web app. Foundry runs beside it on 127.0.0.1:4141 with no public
address, and the web app sends it `FOUNDRY_TOKEN`. Make invite links anywhere
the secret is known: `WEB_SESSION_SECRET=… WEB_URL=https://… pnpm invite rosa`.
To run Foundry alone instead (its API and inspector, no web app), start it
with `glove foundry start` and `kuiper dashboard -u muse --enable`.

Meta's webhook is a route of the same web app, so it needs no second unit:
register `<WEB_URL>/webhooks/whatsapp` with Meta. It checks the signature,
answers Meta at once and forwards each text message to Foundry on loopback.
Without `WHATSAPP_APP_SECRET` and `WHATSAPP_VERIFY_TOKEN` it answers 404.

The two Kuiper references give the unit one gateway key that opens both models
and browsers. `@kuiper-sh/sdk` reads it, calls Muse's and the Sentinel's models
through Kuiper's model gateway, and makes each person's browser.

Conversations, memory, plans, accounts, tokens, the Sentinel's lists, the log
and each person's browser IDs sit on the `/data` disk, so they survive restarts
and redeploys. The browsers and her profile are Kuiper's: a redeploy reconnects to
them. New mail needs nothing public: the Gmail watch pulls its subscription
from inside the unit.

## Where it differs

- Meta gives each person a dedicated VM. Here everyone's Muse shares one
  Foundry unit and its `/data` disk, with memory and the log kept per person;
  only the browser and its profile are each person's own.
- Muse's VM is more than a browser. Here the browser is the whole computer; to
  run code too, add a Kuiper sandbox with `kuiperSandbox` from
  `glove-execution/kuiper`.
- In Muse, nothing reaches the internet unless the Sentinel approves. Here the
  Sentinel guards the browser only; app reads and sends go through Foundry's
  apps, held to the access she chose and to approvals.
- The Sentinel sees what the browser sends while Muse is connected. Redirects
  follow the request it allowed, and while she has the live view the browser is
  hers.
- Muse's Sentinel runs as an agent on the same machine and asks you when
  needed. The Sentinel here judges one request at a time, and its question
  reaches the person through Muse's `request_access`; only the person's
  approval changes what is allowed.
- The checkout's card fields are found by their standard autocomplete names. A
  checkout that keeps them in its payment provider's frame needs that frame's
  locator in `lib/payments.ts`.
- This rebuild doesn't have Muse Charm, Realtime Avatar, phone calling, bank
  access through Plaid or an agent email address. Meta's glasses support is
  still rolling out.
  - Phone calls: Muse calls businesses for you (in testing). Foundry's
    `voiceCall` over a phone provider could, opening by saying it is an AI
    agent calling for the person.
  - Its own email address: a Kuiper inbox with a tagged address per person
    could carry it as a Foundry app.

## Sources

- [Introducing Muse](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/), Meta
- [Meta Muse review](https://www.eesel.ai/blog/meta-muse-agent-review), eesel
- [WhatsApp Cloud API: get started](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started), Meta for Developers
