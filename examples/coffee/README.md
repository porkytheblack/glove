# glove-coffee

Coffee-shop chatbot demo built on `glove-react` + `glove-next`. Used as the
canonical browser-side example for `glove-monitor` telemetry — it ships with a
ready-to-run telemetry loop so you can see events flow end-to-end.

## Run the chatbot only

```bash
cp .env.local.example .env.local
# Set OPENROUTER_API_KEY in .env.local
pnpm dev
# → http://localhost:3000
```

## Run with glove-monitor (telemetry loop)

Three terminals, three commands:

```bash
# Terminal 1 — start the monitor (Hono on :4500, dashboard on :3030)
pnpm monitor

# Terminal 2 — one-time bootstrap: creates the project + reg token,
# writes them into .env.local. Re-run anytime; it's idempotent.
pnpm monitor:bootstrap

# Terminal 3 — start the coffee app
pnpm dev
```

Then open:

- <http://localhost:3000> — the chatbot. Send a few messages.
- <http://127.0.0.1:3030> — the monitor dashboard. The "Coffee Demo" project's
  conversations, tool calls, tokens, and cost should show up live.

The monitor uses SQLite at `.glove-monitor/monitor.db`, so data persists across
restarts. Delete that directory to start fresh.

## How the wiring works

- `BrowserMonitorSubscriber` (in `app/components/chat.tsx`) is attached to the
  glove-react instance via `useGlove({ subscribers: [...] })`. It POSTs every
  `SubscriberEvent` to `/api/glove-monitor/ingest` (relative URL — same origin,
  no credentials in the bundle).
- `app/api/glove-monitor/ingest/route.ts` is a Next.js Route Handler created by
  `createMonitorRouteHandler` from `glove-monitor-client/server`. It holds the
  DCR'd credentials server-side, overrides `user_id` from a server-trusted
  source, and forwards events to the monitor.
- The monitor's `gmonitor.config.ts` runs on a non-default dashboard port
  (3030) so it doesn't clash with coffee's own Next dev server (3000).
