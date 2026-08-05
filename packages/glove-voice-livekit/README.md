# glove-voice-livekit

LiveKit as an adapter in the Glove voice stack — two halves that share one
room connection:

- **`LiveKitTransport`** — the room leg every LiveKit-backed voice host
  otherwise hand-rolls: join, publish the agent's voice as a paced WebRTC
  track, feed remote mic tracks back out as PCM events, carry JSON on the
  data channel. Barge-in is server-authoritative: `clear()` flushes the
  outbound `AudioSource` queue, so there is no client playback buffer to
  chase. `attachRealtime(rt, transport)` binds it to a
  [`glove-voice-s2s`](../glove-voice-s2s) `RealtimeAgent` in one call.

- **LiveKit avatars** — `TavusLiveKitAvatar` and `AnamLiveKitAvatar`
  implement the [`glove-voice-avatar`](../glove-voice-avatar)
  `AvatarAdapter` contract (and pass its conformance suite), so a face over
  LiveKit is interchangeable with the Daily-based Tavus echo adapter:
  `attachAvatar(rt, avatar)` and done. Under the hood they speak LiveKit's
  published avatar protocol — the provider's worker **joins your room as a
  second participant** (token kind `agent`, `lk.publish_on_behalf` pointing
  at your agent) and publishes synchronized voice+face itself; agent PCM
  reaches it over the `lk.audio_stream` byte stream, and barge-in is the
  `lk.clear_buffer` RPC. A glove agent is indistinguishable from a LiveKit
  Agents worker as far as the avatar can tell.

## Voice only

```ts
import { LiveKitTransport, attachRealtime, mintParticipantToken } from "glove-voice-livekit";

const transport = new LiveKitTransport({
  url: process.env.LIVEKIT_URL!,
  token: await mintParticipantToken(
    { apiKey: process.env.LIVEKIT_API_KEY!, apiSecret: process.env.LIVEKIT_API_SECRET! },
    { roomName: "call-42", identity: "agent" },
  ),
});
await transport.connect();
attachRealtime(rt, transport);       // mics → model, model → track, interrupt → flush
await rt.start();
```

## With a face

```ts
import {
  TavusLiveKitAvatar, TAVUS_AVATAR_IDENTITY, mintAvatarToken,
} from "glove-voice-livekit";
import { attachAvatar } from "glove-voice-avatar";

// The avatar publishes the voice on the agent's behalf — don't double it.
const transport = new LiveKitTransport({ url, token, publishAgentAudio: false });
await transport.connect();
attachRealtime(rt, transport, { agentAudio: false });

const avatar = new TavusLiveKitAvatar({
  apiKey: process.env.TAVUS_API_KEY!,
  faceId: process.env.TAVUS_FACE_ID!,   // minimal echo PAL ensured automatically
  livekitUrl: url,
  avatarToken: await mintAvatarToken(creds, {
    roomName: "call-42",
    identity: TAVUS_AVATAR_IDENTITY,
    onBehalfOf: "agent",
  }),
  wire: transport.avatarWire(TAVUS_AVATAR_IDENTITY),
});
await attachAvatar(rt, avatar);       // connects + bridges speech/end/interrupt
```

`AnamLiveKitAvatar` is the same shape (`avatarId` instead of `faceId`,
`ANAM_AVATAR_IDENTITY`); written against Anam's documented API and the
conformance suite, live verification pending a key
([#71](https://github.com/porkytheblack/glove/issues/71)).

Browsers see the avatar as an ordinary room participant: attach its video
track and you have the face — no provider SDK on the client.

See [`examples/livekit-rooms`](../../examples/livekit-rooms) for the full
layered setup (front agent + mesh worker + station rooms) on this transport,
with the avatar as an env toggle.

## Status

Wire protocol validated against LiveKit Agents' published plugins and
`@livekit/rtc-node` type declarations; conformance + unit tests green
(`pnpm test`). Live verification tracked on
[#72](https://github.com/porkytheblack/glove/issues/72).
