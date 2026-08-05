# s2s-agent — a Glove agent on a speech-to-speech model

The smallest complete demo of `glove-voice-s2s`'s `RealtimeAgent`: one Glove
agent — tools authored once, the normal way — running on a realtime voice
model. Both audio modes are covered:

| provider | mode | audio path |
| --- | --- | --- |
| OpenAI Realtime | **device** | WebRTC owns mic + speakers; the page wires nothing |
| Gemini Live | **transport** | the page captures 16 kHz PCM in and plays 24 kHz PCM out (`app/lib/audio.ts`) |

The agent ("Aria") has four tools with *visible* effects, so you can verify
by eye that the voice model is really calling your Glove tools:

- `get_time` — ask "what time is it?"
- `set_theme` — "switch to the sunset theme" recolours the page
- `add_note` — "note down: buy oat milk" pins a note
- `list_notes` — "what are my notes?"

There's also an **Inject** box that pushes text into the live call with
`rt.inject(text, { respond: true })` — the same path an async worker result
takes when it lands mid-conversation and the model relays it out loud.

## Run it

```bash
cp examples/s2s-agent/.env.example examples/s2s-agent/.env.local
# fill in OPENAI_API_KEY and/or GEMINI_API_KEY

pnpm install
pnpm --filter glove-s2s-agent-example dev
```

Open http://localhost:3000, pick a provider, hit **Start talking**, and allow
the microphone.

## Notes

- The Gemini token route hands the raw `GEMINI_API_KEY` to the browser —
  dev-only. Mint an ephemeral token via the Live `auth_tokens` API for
  anything deployed.
- The agent's `ModelAdapter` is a stub: this demo only runs voice turns, and
  `RealtimeAgent` never invokes Glove's own loop. Wire a real adapter to
  serve text turns from the same agent.
- Barge-in is provider-native. In transport mode the page flushes its
  playback queue on the adapter's `interrupted` event so interrupted speech
  cuts immediately.
- The Gemini adapter passes the package's conformance suite but has not been
  verified against the live API from this repo's CI (no credentials there) —
  this example is exactly that verification.
