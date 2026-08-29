# Foundry Drag Racer Calls

A complete Gemini Live speech-to-speech application built with Glove Foundry. Pick one of three fictional drag racers in the web interface, join a live call, and ask about their car, setup, history, or opinions of the other racers.

This is intentionally a Foundry application rather than a custom runtime worker. Each `agents/<route>/agent.ts` file is a pure definition. Foundry lazily assembles its Glove model, system prompt, tools, store, and custom live-room `run` from the current message, agent instance, conversation, and request payload.

## Run it

Requirements: Node 22+, pnpm, and a Gemini API key with Live API access.

```bash
cd examples/foundry-drag-racers
cp .env.example .env
# Add GEMINI_API_KEY to .env
pnpm dev
```

Open [http://localhost:3002](http://localhost:3002), choose a racer, allow microphone access, and call. The Gemini key stays in the Foundry agent subprocess; the browser receives only a short-lived, random room capability.

Useful checks:

```bash
pnpm verify       # no API key or network required
pnpm typecheck
pnpm build
pnpm verify:live  # key/model/WebSocket smoke test
```

## Architecture

```text
Next UI ── POST /api/calls ──▶ Foundry client ──▶ file-routed agent run
   │                                                   │
   └── 16 kHz PCM + control WebSocket ────────────────▶│ RealtimeAgent
                                                       │
                                               Gemini Live API
                                                       │
                      16 kHz playback ◀── resample 24 kHz output
```

- `foundry.application.ts` owns three persistent agent instances and three conversations.
- `agents/*/agent.ts` are the file routes. A shared composition factory avoids repeating structure while preserving distinct definitions.
- `agents/_shared/create-racer.ts` demonstrates message-aware lazy assembly. The initial message can change the model options, prompt, and exposed tool set; a diagnostic message mounts an extra context-inspection tool.
- `agents/_shared/racer-room.ts` is the custom Foundry run. It receives the fully assembled `IGloveRunnable`, wraps it in Glove's `RealtimeAgent`, and hosts the authenticated PCM duct until the run is cancelled or idle.
- Native Glove tools are projected into Gemini function declarations and executed through the same `Tool.run` path as other Glove agents.
- Every call remains a normal observable Foundry run. Room lifecycle and tool phases are emitted as correlated agent events.
- Gemini expects raw 16-bit little-endian PCM at 16 kHz and produces 24 kHz PCM. The server resamples output so the browser worklet has one fixed 16 kHz contract.

The people, cars, performance figures, rivalries, and generated portraits in this example are fictional.
