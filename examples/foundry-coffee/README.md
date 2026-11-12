# Coffee Shop on Foundry

The [coffee example](../coffee) rebuilt as a Glove Foundry app, with a voice
pipeline that uses everything ElevenLabs Scribe v3 added: Scribe ends the
turns, tells the people at the counter apart, and transcribes recorded
orders.

Same shop, same six coffees, same look. What changed is where the agent
lives. In `examples/coffee` the agent loop runs in the browser. Here the
barista is a Foundry agent: each customer is a conversation, every message is
a run, the bag and the orders are stored in the shop's workspace, and
checkout is a Foundry approval the customer answers on screen.

```
  browser                          Next.js server              Foundry (loopback)
  ───────                          ──────────────              ──────────────────
  microphone ─► GloveVoice
     Silero VAD (gates audio)
     Scribe v3 Live (text, turn
       end, who is speaking)
           │ "[Maya] one Huila…"
           ▼
     FoundryRunnable ──POST /api/turn──► send(conversation) ──► run: barista
           ▲                                                      tools, bag,
           └──── server-sent events ◄── run events ◄──────────────approval
     text ─► ElevenLabs TTS ─► speaker
```

## Run it

```bash
pnpm install                 # from the repository root
cd examples/foundry-coffee
cp .env.example .env         # add your keys (see below)
pnpm dev
```

- Shop: http://localhost:3010
- Foundry inspector: http://127.0.0.1:4310 (every run, model request, tool call and approval)

| Key | What it turns on |
| --- | --- |
| `ELEVENLABS_API_KEY` | Voice (Scribe v3 Live, the barista's voice) and recorded orders (Scribe v3). Without it the shop works by text. |
| `ANTHROPIC_API_KEY`, or `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY` | A real barista. Without one a scripted barista answers; it understands a few phrases ("show me all your beans", "add the Huila Reserve", "check out") and is enough to test the voice pipeline. |

The bar at the top of the page says which of these are active.

`pnpm verify` runs a whole visit with no keys and no network: a typed visit
over Foundry's HTTP API, then a spoken one through the real `GloveVoice` with
scripted speech in place of a microphone.

## What to test

Start voice with the microphone button. The **Scribe** panel on the right
shows what Scribe sends as it sends it, so each feature below can be seen
rather than inferred.

### 1. Scribe ends the turn (`turnMode: "stt"`)

Under the input, **Turns end by** picks who decides you have finished:

| Setting | What happens | Adapter |
| --- | --- | --- |
| Scribe turn prediction (default) | Scribe v3 Live predicts the end of your turn from what you said. | `commitStrategy: "turn_prediction"`, `turnMode: "stt"` |
| Scribe VAD | Scribe commits after a silence. | `commitStrategy: "vad"`, `turnMode: "stt"` |
| Local VAD | The local VAD commits after its own silence window. This is how it worked before Scribe v3; use it to compare. | manual commits, `turnMode: "vad"` |

What to look for:

- **End of turn** meter: Scribe's probability that you are done, for what it
  is hearing now. Say "I'd like…" and stop: it should stay low. Finish the
  sentence: it should rise.
- A `commit` line ("Scribe committed") when Scribe ends the turn itself.
- A `flush` line when this side asked for the commit: always in Local VAD
  mode, and in the Scribe modes only when Scribe stayed silent for 2.5s after
  you stopped (the fallback).
- Try a mid-sentence pause ("Can I get the… um… Huila Reserve"). With turn
  prediction the barista should wait for the end of the sentence.
- Say two things close together ("Add the Huila. And what's in my bag?").
  Both should reach the barista.

### 2. Speakers (`diarize: true`)

Leave **Tell speakers apart** on and bring a second person (or play a second
voice from a phone).

- While one person talks, the barista gets plain text.
- From the second voice on, each line is labelled: the message shows
  `Speaker A` and `Speaker B` chips, and a `labels` line appears in the
  Scribe panel when Scribe's settled labels arrive.
- **At the counter** lists everyone heard, their share of the talking, and
  who has done most of it.
- Have one person say "I'm Maya". The barista calls `name_speaker`; from then
  on her lines read `Maya`. You can also click a label to name it yourself.
- Order for yourselves separately ("the Huila for me" / "two Lake Kivu for
  me"). The bag shows who each line is for.
- Stay quiet for more than 15 seconds, then speak again. The labels should
  not start over (`sttKeepAliveMs` keeps Scribe's session open).

### 3. Product names (keyterms)

The six coffee names are sent to Scribe as keyterms. "Yirgacheffe",
"Mandheling" and "Nyeri" are the ones speech recognition usually gets wrong.

### 4. Recorded orders (batch Scribe v3)

**Recorded order** in the right panel uploads an audio or video file (with
voice off; the button is disabled while the microphone is on). It is
transcribed with `transcribeWithElevenLabs` (`scribe_v3`, `diarize: true`,
the same keyterms) and handed to the barista with a line per speaker.

### 5. The Foundry side

- Checkout: say or type "check out". The run pauses on an approval; the
  order summary appears with **Place order** / **Not yet**. Nothing is ordered
  until you confirm. While it waits, speech is not treated as an interruption.
- Interrupt the barista mid-sentence. The run is cancelled in Foundry and the
  next thing you say starts a new one.
- Open the inspector, pick a spoken run, and look at its model request: the
  note about who is speaking is there, and it is not in the saved transcript.

If something looks wrong, the Scribe panel's log and the inspector's run page
are the two things worth sending along.

## How voice reaches a Foundry agent

`GloveVoice` drives a Glove agent through three calls: `processRequest`, the
agent's subscriber events, and `addContextProvider`. A Foundry agent runs on a
server, one process per message, so the browser holds a stand-in:

- [`app/lib/foundry-runnable.ts`](app/lib/foundry-runnable.ts) implements
  those calls. `processRequest(text)` posts the turn; run events come back as
  the `text_delta` and `model_response_complete` events GloveVoice turns into
  speech. Aborting (a barge-in) cancels the run.
- Who is speaking never goes into the conversation. GloveVoice's note is read
  once per turn and sent in the request `payload`; the agent's
  `contextProviders` field ([`agents/barista/agent.ts`](agents/barista/agent.ts))
  gives it to the model for that request only.
- Speaker names go the other way. The barista's `name_speaker` tool runs in
  Foundry, but the labels live in the browser's voice pipeline, so the tool
  emits a run event and the page applies it with `voice.nameSpeaker`.

## Where things are

```
agents/barista/agent.ts     the definition: model, store, prompt, tools, context
agents/barista/prompt.ts    instructions; extra sections when spoken, and when several people speak
agents/barista/tools.ts     show_products, add_to_cart, checkout (needs approval), name_speaker…
agents/barista/voice.ts     reads the spoken turn's payload
foundry.application.ts      the shop's barista instance; data in .data/foundry.json
lib/                        catalogue, bag, model choice, scripted barista, transcript store
app/api/turn/route.ts       one turn: send to Foundry, relay the run as server-sent events
app/api/transcribe/route.ts recorded orders with batch Scribe v3
app/lib/voice.ts            the Scribe v3 Live adapter and its settings
app/lib/use-scribe-monitor.ts  the Scribe panel's data
app/page.tsx                wires the shop, the voice pipeline and the panels together
scripts/verify.ts           the offline check
```

State lives in `.data/` (instances, conversations, bags, orders, transcripts).
Delete it to start clean.

## Limits

- One shop, no sign-in: anyone who can open the page is a customer. Foundry
  stays on loopback and only the Next.js server talks to it.
- Made to run on your own machine. Nothing checks who is calling: a
  conversation id is enough to read that conversation's bag and orders, and
  the transcription and voice token routes spend your ElevenLabs key for
  anyone who can reach them. Put sign-in and a rate limit in front of the
  app before exposing it.
- A checkout confirmation is good for a minute. After that the card can no
  longer be answered and the barista has to be asked again. Foundry keeps
  the approval open for longer; answered from the inspector or the API, it
  orders the bag as it stands then.
- Speaker labels are per voice session. They start over if the page reloads
  or the speech connection restarts, and the barista is told when that
  happens.
- The scripted barista matches phrases; it does not understand. Set a model
  key before judging how the conversation feels.
