# livekit-rooms — the layered voice architecture over a LiveKit transport (avatars included)

The fifth step in the voice-example series, kept as its own example so every
step stays runnable ([#72](https://github.com/porkytheblack/glove/issues/72)):

| example | pipeline | transport |
| --- | --- | --- |
| [`examples/layered-voice`](../layered-voice) | cascade (VAD → STT → LLM → TTS) | browser-hosted |
| [`examples/server-voice`](../server-voice) | cascade | bespoke WS duct (raw PCM) |
| [`examples/s2s-rooms`](../s2s-rooms) | speech-to-speech | bespoke WS duct |
| [`examples/avatar-rooms`](../avatar-rooms) | speech-to-speech + Tavus face | duct up, Daily room down |
| **this** | speech-to-speech (+ optional LiveKit avatar) | **LiveKit, both directions** |

Same starship shop, same layering — thin front agent driven by the realtime
model, capable worker over the mesh, rooms as station signal runs — but the
transport is now an adapter, [`glove-voice-livekit`](../../packages/glove-voice-livekit):
`LiveKitTransport` owns the pipes, `attachRealtime` binds the agent, and with
`AVATAR_PROVIDER=tavus|anam` the provider's avatar worker **joins the same
room as a participant** (`TavusLiveKitAvatar` / `AnamLiveKitAvatar` — the same
`AvatarAdapter` contract as the Daily-based echo adapter), publishing the
agent's voice and face itself while the agent feeds it PCM over LiveKit's
avatar datastream protocol:

```
  Next.js app (:3003)            livekit-room SIGNAL RUN — one per call
  ───────────────────            ──────────────────────────────────────────────
  Room.connect(url, token)       agent joins the SAME LiveKit room via
  setMicrophoneEnabled(true)     @livekit/rtc-node:
        │  WebRTC tracks              mic track  ──▶ resample ──▶ S2S model
        ▼                             S2S audio  ──▶ AudioSource ──▶ agent track
  ┌─────────────────┐                 barge-in   ──▶ source.clearQueue()
  │  LiveKit room   │◀───────────     transcripts/state ──▶ data channel JSON
  └─────────────────┘
                                        │ glove_mesh_send_message
                                        ▼
                                  research SIGNAL — the worker (unchanged)
                                        │ threaded mesh reply
  POST /mesh (:480x) ◀──────────────────┘ → rt.inject(…, { respond: true })
```

What the transport swap buys, measured in deleted code: the browser hook drops
from ~500 lines to ~250 — no audio worklets, no playback ring buffer, no local
VAD reflex, no pause/resume/clear dance, no drain accounting. LiveKit's WebRTC
stack owns capture, echo cancellation, jitter and codecs; barge-in is
server-authoritative (the room flushes its own outbound `AudioSource` queue,
so there is no client buffer to chase). The room's HTTP port now carries only
`/health` and `/mesh` — audio never touches it.

## Run it

You need a LiveKit server. The Cloud free tier works: create a project at
cloud.livekit.io and copy the URL + API key/secret. (Self-hosted works too.)

```bash
cp .env.example .env.local
# LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET   — the transport
# OPENAI_API_KEY (or GEMINI_API_KEY)                   — the brain + voice
# OPENROUTER_API_KEY                                   — the worker
# STATION_USERNAME / STATION_PASSWORD
# AVATAR_PROVIDER=tavus + TAVUS_API_KEY/TAVUS_FACE_ID  — optional: the face
#   (or AVATAR_PROVIDER=anam + ANAM_API_KEY/ANAM_AVATAR_ID)

pnpm install                   # from the repo root
pnpm start                     # station: runner + dashboard on :4430
pnpm key "web app" trigger read cancel   # → STATION_API_KEY into .env.local

cd web && pnpm dev             # the app on :3003
```

Open http://localhost:3003, Connect, and allow the mic. The app triggers a
`livekit-room` signal run, mints a caller token server-side (the browser never
sees the API secret), and joins the LiveKit room the agent is already sitting
in. Ask for a price and watch the delegation run in the station dashboard
(:4430/signals) while the conversation keeps flowing.

Ports are shifted so this runs side by side with the whole series: station
:4430, room signal ports :4801+ (health + mesh only), web :3003.

With an avatar enabled, the agent stops publishing its own audio track — the
avatar worker publishes the synchronized voice+face on the agent's behalf,
and the page shows the video next to the transcript. Barge-in chains all the
way through: provider VAD → S2S `interrupted` → transport flush + avatar
`lk.clear_buffer` RPC.

## Status

[#72](https://github.com/porkytheblack/glove/issues/72): milestone 1 (voice
transport parity over LiveKit) and milestone 2 (LiveKit avatars as glove
adapters) are both here. The transport path is live-verified; the avatar path
is conformance-tested against the published LiveKit avatar protocol — live
verification with a Tavus key is the next step (Anam pending a key,
[#71](https://github.com/porkytheblack/glove/issues/71)).
