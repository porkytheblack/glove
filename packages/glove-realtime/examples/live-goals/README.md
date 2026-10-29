# GPT-Live sales call demo

An agent-initiated sales discovery conversation, using actual Glove goals.
The caller plays a salon owner. The agent discovers needs, checks fictional
product plans, explains a suitable recommendation, handles questions, and
asks for a next step. A refusal is a valid outcome. Nothing is purchased or
scheduled, and this demo does not dial a phone number.

## Run

Use Node 22+ and the repository's pnpm dependencies. Build the workspace
dependencies if this is a fresh checkout:

```sh
pnpm --filter glove-realtime... build
pnpm --filter glove-realtime demo:live
```

The server reads `OPENAI_API_KEY` from the repository root's ignored
`.env.local`. The key stays server-side. Open <http://127.0.0.1:4317>.

1. Click **Start call**. The agent introduces itself and asks to talk.
2. Respond naturally using typed input, or **Enable microphone** and hold
   **Hold to talk**. For example, you run a salon with 250 appointments per
   month, use phone bookings/manual reminders, and want fewer no-shows.
3. Watch the actual goal states change when the model calls
   `glove_goal_update`; the UI does not infer progress from captions.
4. After the recommendation, click **Inject new pilot offer**. It changes
   Growth from $49 to $39 and calls `agent.emitEvent`. The agent should
   proactively explain the change without another caller message.
5. Ask a question or raise an objection, then accept a demo, decline, or ask
   for follow-up. `record_next_step` records only this demo's decision.
6. End and restart the call. The agent keeps the stored conversation and goal
   progress. **Reset demo** or restarting the server clears this in-memory state.

Five minutes maximum per provider session. End the call when finished.
The local server allows one browser connection and binds only to loopback.
It is a development example, not a production authentication or telephony service.

## Where to inspect the code

- [agent.ts](agent.ts): ordinary Glove definition, `useGoalRunner` with history
  delivery, real goal tools, product tools, and spontaneous event producer.
- [server.ts](server.ts): `RealtimeSession`, audio relay, captions, initiation,
  playback/speech notifications and cleanup. No speech-to-speech package.
- [client.js](client.js) and [capture.js](capture.js): browser audio capture,
  playback, push-to-talk, typed replies and visible goal/tool evidence.
- [smoke.ts](smoke.ts): bounded real-provider test. No fake socket and no direct
  invocation of business or goal tools to manufacture success.

Goals reach GPT-Live as history-delivered runtime context. The model decides
which question or action comes next, then records supported progress through
Glove's versioned goal tools. Tool results carry progress immediately; a changed
history snapshot is saved at the next user boundary. The product event is
delivered through Glove's event scheduler and saved once by stable event ID.

GPT-Live has a voice model and a Responses backend. Silent/context appends
reach the voice model; goal/status tools read the authoritative state from the
backend. Typed replies use backend user messages, not voice commentary.

## Real-provider verification

```sh
pnpm --filter glove-realtime typecheck:demo
pnpm --filter glove-realtime test
pnpm --filter glove-realtime test:live
```

`test:live` consumes API credits. It starts a real GPT-Live session, sends paced
PCM silence and typed prospect replies, observes actual model tool calls,
asserts goal progress and a proactively spoken offer, then opens a fresh
provider session to check recall without resetting goals. Each wait is bounded;
the provider is closed even on failure. Model behavior can vary: a failed
assertion is a failure, never converted into a simulated pass.

Evidence goes to `/tmp/glove-live-goals-report.json`, with captured provider
audio at `/tmp/glove-live-goals-report.wav`. Set `DEMO_REPORT` to choose a
different JSON path. This test verifies typed-input-to-live-audio behavior;
microphone recognition and physical playback need the browser voice check.

Verified on October 29, 2026 with GPT-Live and a GPT-6 Luna Responses backend:
all nine live assertions passed, including model-written goal progress, product
tool calls, an unsolicited spoken offer, one saved event, three changed goal
snapshots, a completed goal set and recall in a fresh provider session. The
browser was also exercised with partial discovery answers: the agent asked for
missing appointment volume, reacted to the offer and recorded a demo decision.
Speech occasionally repeated itself; this is integration evidence, not a sales
quality evaluation or proof of microphone/telephony behavior. Gemini Live and
OpenAI Realtime were covered by automated protocol tests, not this live run.

GPT-Live streams silence too. The browser distinguishes audible playback with
an energy threshold and a short hangover so silence does not indefinitely block
spontaneous events. A production audio bridge should supply its own tested
playback/VAD signal. Transcripts are fragments, not turn boundaries.

Provider references: [Live delegation and typed input](https://developers.openai.com/api/docs/guides/live-delegation)
and [Live session management](https://developers.openai.com/api/docs/guides/live-conversations).
