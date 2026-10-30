# Realtime front with a durable researcher

Complete source for `/foundry/docs/durable-subagents`. This uses the APIs in the current checkout; the durable-worker API may not yet be in the registry release.

From the repository root, run `pnpm install`, then `pnpm -r --filter 'glove-foundry-durable-research^...' build` to build the example's workspace dependencies. Use Node 22.13+ for SQLite memory. In this folder, put `GEMINI_API_KEY` in an untracked `.env`; optionally set `REALTIME_MODEL`, `RESEARCH_TEXT_MODEL`, and `RESEARCH_DATA_DIR`. Then:

```sh
pnpm --filter glove-foundry-durable-research typecheck
pnpm --filter glove-foundry-durable-research verify # offline; no model calls
pnpm --filter glove-foundry-durable-research start
# In another terminal, from this folder:
node --import tsx scripts/message.ts
```

Open the local room URL printed by the start script once the provider connects. This is a native realtime session with typed input and text output, not a loop of text-model requests. Ask it to delegate a vendor comparison to `research`, then keep chatting. The fixture corpus is fictional and small; it finishes quickly. The researcher has a four-hour run allowance, not a simulated four-hour delay.

For OpenAI, set `RESEARCH_PROVIDER=openai` and `OPENAI_API_KEY` instead. The defaults are `gpt-realtime` for the live front and `gpt-4.1-mini` for research/text fallback; `REALTIME_MODEL` and `RESEARCH_TEXT_MODEL` override them. `RESEARCH_DOCUMENT_DELAY_MS` (0–10000) adds simulated document-service latency.

Run `pnpm --filter glove-foundry-durable-research verify:live` for an opt-in live OpenAI test. It reads the repository's ignored `.env.local` when present (or uses the environment), makes real model calls, and uses only the fictional local app. It tests direct round trips, responsiveness during research, delegated questions/answers/results, deferred delivery and interrupted work across separate controller processes, expiry, deduplication and exact conversation ownership. Each run uses a new temporary data directory and prints its report location. It does not modify the demo's `.data` or contact a real third-party app.

The controller stays alive when you end the live session. Later worker results run the front's text fallback and persist in the same transcript. Restart `start` to reopen `demo-live`; the new realtime session loads the persisted conversation. A process restart reconstructs the worker and replays pending durable events; it does not guarantee resumption of an in-progress external tool call or provider socket.

`agents/front/agent.ts` selects inherited context, search, read-only memory and the installed library's read tool. The front's approval-gated write tool is denied during realtime sessions, and is not inherited. No account-backed app is configured: operation and transmission grants are empty. Replace the fixture corpus with an authenticated application adapter for real research.

Persistence is separate: `.data/foundry.json` stores workers/events/receipts; `.data/transcripts` stores native transcripts; `.data/personal.sqlite` stores parent memory; workspace notes belong to the parent workspace. Worker purge removes owned Foundry records and invokes the transcript cleanup hook; shared parent memory and notes remain.

Use one controller per data store. The local example allows one live room on port 8787. For deployment, supply request authorization, an authenticated per-session transport, persistent storage, and enough execution slots for responsive fronts alongside workers. API keys stay server-side. Live provider calls incur normal provider charges; offline verification must not make them.
