# Server-hosted voice rooms: a production design document

For engineers building a real-time voice agent on this pattern. It is
self-contained — you do not need to read the example's code or its README first.

Part I describes **what the system is and how it works**. Part II describes
**what must stay true when you rebuild it**, the failure modes that follow from
getting it wrong, and what in the reference implementation is deliberately
demo-grade.

Everything in Part II was found by debugging real calls. Almost all of it
presents identically from the caller's side — *the room stopped listening to me*
— so the symptom carries no information about the cause. That is what makes it
worth writing down.

---

# Part I — What this is

## 1. The problem

A voice agent has to do six things between a person finishing a sentence and
hearing a reply:

1. Decide there is a voice at all (**VAD**)
2. Turn audio into words (**STT**)
3. Decide the person is *finished* (**endpointing / turn-taking**)
4. Think of a reply (**the agent**)
5. Turn the reply into audio (**TTS**)
6. Stop instantly when the person starts talking again (**barge-in**)

Steps 3 and 6 are where voice agents feel broken. Steps 1, 2, 4 and 5 are mostly
vendor calls. The hard, product-defining engineering is *"has this person
finished talking, and what exactly did they say?"* — and every guard in Part II
exists to protect that question from a component that is confidently wrong.

## 2. Where the work lives

The decision that shapes everything else: **the client captures and plays audio,
and makes no decisions.** Every production voice platform converges on this
(LiveKit Agents, Pipecat, Vapi, Retell), for reasons that become concrete below.

```mermaid
flowchart LR
    subgraph CLIENT["Browser / phone — an audio duct"]
        MIC["microphone<br/>+ echo cancellation"]
        SPK["speaker"]
    end

    subgraph ROOM["Room process — one per conversation"]
        VAD["VAD"]
        STT["STT socket"]
        ENG["commitment<br/>engine"]
        EOU["end-of-utterance<br/>model, in-process"]
        AGENT["front agent"]
        TTS["TTS socket"]
    end

    subgraph WORKER["Worker process — shared"]
        W["heavy model<br/>+ database tools"]
    end

    MIC -->|"PCM16 frames"| VAD
    MIC -->|"same PCM16, always"| STT
    VAD -->|"speech boundaries"| ENG
    STT -->|"partial + committed text"| ENG
    ENG <-->|"~25 ms"| EOU
    ENG -->|"committed utterance"| AGENT
    AGENT -->|"spoken tokens"| TTS
    TTS -->|"PCM16 chunks"| SPK
    AGENT -.->|"delegate, non-blocking"| W
    W -.->|"reply arrives later"| AGENT
```

**Why it matters that the room owns endpointing.** If the commitment engine runs
in the browser and the end-of-utterance model runs on a server, *every speech
boundary* costs an HTTP round trip — with a timeout, and a worse heuristic for
when the network is slow. In one process it is a ~25 ms function call. The same
move deletes per-session credential minting, and makes tuning a server config
change rather than a client deploy.

**The cost, stated honestly:** one extra network hop for audio (client → room →
vendor, instead of client → vendor). It roughly cancels against the round trips
deleted, and it buys everything above — including the ability to terminate a
phone call into the same room a browser connects to, because the session logic
cannot tell the difference.

## 3. Anatomy of a turn

Timings are measured on a live room, not estimated.

```mermaid
sequenceDiagram
    participant C as Caller
    participant V as VAD
    participant S as STT
    participant E as Engine
    participant M as EOU model
    participant A as Agent
    participant T as TTS

    C->>V: audio frames (32 ms each)
    C->>S: same frames
    S-->>E: partial: "how much does the"
    S-->>E: partial: "how much does the Kestrel cost"
    C->>V: (stops speaking)
    Note over V: 450 ms trailing silence
    V-->>E: speech_end
    E->>M: score "how much does the Kestrel cost?"
    M-->>E: P(finished) = 0.94 → hold 400 ms
    Note over E: hold measured from when they<br/>STOPPED, not from now
    E->>A: commit utterance
    Note over C,T: ~937 ms speech-end → commit
    A-->>T: first spoken tokens (streaming)
    T-->>C: first audio
    Note over C,T: ~1.5 s voice-to-voice
```

Two details in that diagram are load-bearing and easy to get wrong:

- **The hold is anchored to when the caller stopped**, not to when the decision
  was made. Anchoring it to "now" adds the scoring latency on top of the hold.
  Re-anchoring took a measured 1304 ms commit down to 722 ms.
- **The agent streams into TTS.** Audio starts on the first spoken token, not on
  the finished sentence.

## 4. The commitment engine

This is the component you will spend your time in. Its job: decide when the
buffered transcript becomes a turn.

It answers with **two models asking different questions.** The acoustic model
(VAD) decides *when to ask*. The semantic model (EOU) decides *how long to wait*.

```
hold = min_hold + (max_hold − min_hold) × (1 − P)^1.5
```

where `P` is the model's probability that the text is a finished thought. At the
defaults (400 ms / 2800 ms): a confident question holds 400 ms, a trailing
"so I was thinking…" holds well over two seconds.

### Four ways a turn commits

A single path is not enough, because in a real room the VAD can fail to produce
a boundary at all — a television is speech, so it can stay "speaking"
indefinitely; a bad model state can stop firing entirely.

```mermaid
flowchart TD
    P["transcript in buffer"] --> Q{"VAD said<br/>speech_end?"}
    Q -->|yes| H["score with EOU<br/>→ hold"]
    H --> HG{"grew during<br/>the hold?"}
    HG -->|yes| R["re-score with<br/>fuller text"]
    R --> H
    HG -->|no| COMMIT["commit"]
    Q -->|"no, still 'speaking'"| ST{"text unchanged<br/>1500 ms?"}
    ST -->|yes| SC["score with EOU"]
    SC -->|"confident"| COMMIT
    SC -->|"unsure"| ST
    Q -->|"no boundary at all"| SW{"idle and text<br/>still 1200 ms?"}
    SW -->|yes| COMMIT
    COMMIT --> G["guards"]
    G -->|"passes"| OUT["dispatch to agent"]
    G -->|"fails"| DROP["drop, and say so<br/>on the console"]
```

`endpoint`/`hold` is the normal path. `stable` covers a VAD stuck on, `sweep`
covers a VAD that never fires — **a turn that never commits is a room gone
deaf**, which is the worst outcome available, so both fallbacks exist.

### The guards

Every commit passes four checks. Each exists because of a specific live failure
(see §13):

| Guard | Question | Rejects |
| --- | --- | --- |
| Freshness | Did anyone actually speak recently? | Hallucinations from silence |
| Near-field | Was it *this* caller? | The next table over |
| Prefix dedupe | Have we already sent these words? | Re-punctuated echoes of a sent line |
| Tail extension | Is this a correction or just lag? | Duplicate replies to one sentence |

## 5. Full duplex: the gate governs ownership, not the microphone

The single most consequential design decision, and the one most likely to be
"optimized" away by someone who did not have to debug it.

```mermaid
flowchart LR
    MIC["microphone"] --> VAD["VAD"]
    MIC --> STT["STT"]
    STT --> BUF["transcript buffer"]
    BUF --> GATE{"gate:<br/>who owns<br/>this text?"}
    GATE -->|"agent idle → caller owns it"| AG["dispatch to agent"]
    GATE -->|"agent speaking, interruption confirmed"| CLAIM["claim buffer,<br/>cut the agent off"]
    GATE -->|"agent speaking, turn ended unclaimed"| DISCARD["discard as echo"]
```

Audio **always** reaches both the VAD and the STT — including while the agent is
speaking. What the gate decides is what happens to the *text* produced during
the agent's turn.

Stop the audio instead, and the room is half-duplex: the caller can only
interrupt with noise, never with words. That matters because the strongest
available evidence of a real interruption is *words appearing in the transcript
while the agent holds the floor* — echo cancellation mangles the caller's audio
badly enough that a genuine interruption is often scored as noise by the VAD.
Cutting the audio throws away the best signal you have.

## 6. Barge-in is two decisions

```mermaid
stateDiagram-v2
    [*] --> Speaking: agent takes the floor
    Speaking --> Paused: any speech-ish frame, 85-128 ms, unconditional
    Paused --> Cut: transcript grew, or VAD confirmed speech
    Paused --> Speaking: silence, it was a cough — resume mid-word
    Cut --> Listening: drop buffered audio, caller owns the floor
    Speaking --> Listening: finished normally
    Listening --> Speaking: next reply
```

**Stopping is free; committing is careful.** Pausing on the first hint of a voice
costs nothing if wrong — playback resumes mid-word. Cutting the turn discards
what the agent was saying, so it waits for evidence.

The retraction path is where this gets subtle: a VAD that calls a real
interruption a misfire will *resume the agent over the caller*, which reads as
the agent ignoring them. Transcript growth overrules the retraction.

## 7. Delegation: slow work without a silent room

A database lookup takes seconds. A conversation cannot wait seconds.

```mermaid
sequenceDiagram
    participant C as Caller
    participant A as Front agent
    participant W as Worker process

    C->>A: "how much does the Kestrel cost?"
    A->>W: delegate (non-blocking dispatch)
    A-->>C: "Let me check that for you." (same turn)
    Note over A: turn ends; room stays responsive
    C->>A: "and does it come with a warranty?"
    A-->>C: handles this normally
    W-->>A: result arrives (own schedule)
    A-->>C: relays the answer
```

The rule that makes this work: **the acknowledgement and the dispatch happen in
the same turn.** An agent that says "let me check" without actually dispatching
leaves the caller waiting forever, so the orchestrator watches for that and
nudges. The reply arrives as a separate wake-up, not as a return value.

---

# Part I½ — The contracts

Everything above is portable to any stack. This section is the concrete
reference: the packages, the interfaces to implement, and where each concept
lives in the source.

## 8. Packages

The pipeline is vendor-shaped at the edges and vendor-neutral in the middle. You
swap vendors by implementing four interfaces (§9), not by editing the engine.
The appendix maps every concept in this document to the file that implements it.

**Runtime, in the room process:**

| Package | Version | Why it's here |
| --- | --- | --- |
| `glove-voice` | workspace | The adapter interfaces + the ElevenLabs STT/TTS and Silero VAD implementations. Entry points: `.`, `./server`, `./silero-vad` |
| `glove-core` | workspace | The agent runtime (`Glove`, tools, model adapters) |
| `glove-mesh` | workspace | Agent-to-agent messaging — how delegation and the async reply work |
| `onnxruntime-node` | ^1.22 | Runs Silero VAD server-side. The browser package is `onnxruntime-web` |
| `@huggingface/transformers` | ^4.2 | Runs the end-of-utterance model **in-process** — this is what makes turn-taking a ~25 ms call instead of an HTTP round trip |
| `ws` | ^8.18 | The room's audio WebSocket |
| `eventemitter3` | ^5.0 | Adapter event plumbing |
| `zod` | ^4.3 | Room input validation |

**Process supervision** — `station-kit`, `station-signal`, `station-adapter-sqlite`
(^2.0). Substitutable: any supervisor that gives you a process per call with a
lifecycle API, a timeout, and SIGTERM on cancel will do. What the room needs from
it is exactly that and nothing more.

**Browser side** — no vendor SDK at all. Two `AudioWorklet` files and a
WebSocket. `@ricky0123/vad-web` + `onnxruntime-web` appear only if you want the
optional client-side reflex VAD (§6); the room works without it.

> **Sample-rate note.** Silero VAD requires **16 kHz mono**, 512-sample frames
> (32 ms). Recognizers often accept more. If you raise capture above 16 kHz for
> transcription quality, you must downsample for the VAD — they are not
> interchangeable paths.

## 9. Interfaces to implement

Four adapters. Implement these and the engine does not care who the vendor is.

```ts
// Voice activity. 32 ms frames in, boundary events out.
interface VADAdapter extends EventEmitter<VADAdapterEvents> {
  process(pcm: Int16Array): void;
  reset(): void;                      // call on a stale/gap state — see §13
  readonly isSpeaking: boolean;
  readonly supportsRealStart?: boolean;
}

type VADAdapterEvents = {
  speech_start: [];        // tentative — may still be retracted
  speech_real_start: [];   // survived the minimum-duration filter → barge-in
  vad_misfire: [];         // the tentative start was noise
  speech_end: [];
  speech_prob: [prob: number];   // per-frame, [0,1]
};
```

The `speech_start` / `speech_real_start` / `vad_misfire` triad is what makes
two-stage barge-in (§6) possible: pause on the tentative event, decide on the
confirmation. An adapter without it sets `supportsRealStart: false` and the room
falls back to a single-stage cut.

```ts
// Speech recognition. Audio in, partial + committed text out.
interface STTAdapter extends EventEmitter<STTAdapterEvents> {
  connect(): Promise<void>;
  sendAudio(pcm: Int16Array): void;   // 16 kHz mono
  flushUtterance(): void;             // force a commit
  disconnect(): void;
  readonly isConnected: boolean;
  readonly currentPartial: string;    // the engine reads this directly
}

type STTAdapterEvents = {
  partial: [text: string];
  final: [text: string];
  error: [Error];
  close: [];
};
```

`currentPartial` being readable synchronously is load-bearing: the engine commits
from the *partial* rather than waiting for the vendor's own commit round trip,
then swallows the confirming `final`. That is worth several hundred ms per turn.

```ts
// Turn-taking. Text in, "wait this much longer" out.
interface TurnDetectorAdapter {
  decide(
    transcript: string,
    context?: TurnContextMessage[],
  ): TurnDecision | Promise<TurnDecision>;
}

interface TurnDecision {
  holdMs: number;   // 0 = commit now; cancel the hold if they resume
  reason: string;   // short label, lands in metrics — e.g. "eou-q:1.00"
}
```

Keep `reason` machine-friendly. It is what lets you answer "why was that turn
slow?" from a metrics file instead of a re-run.

```ts
// Speech synthesis. Streaming text in, streaming audio out.
interface TTSAdapter extends EventEmitter<TTSAdapterEvents> {
  open(): Promise<void>;
  sendText(text: string): void;   // safe before open() resolves; queue internally
  // …flush / close
}
```

## 10. Wiring: the two objects you assemble

```ts
// The commitment engine — the component from §4.
new TurnEngine({
  stt, detector, hooks,
  vadSilenceMs?, vadThreshold?,
  farFieldRatio?,          // 0 disables the near-field gate
});

interface TurnEngineHooks {
  onUtterance(text: string): void;              // a turn is ready
  onPartial(text: string): void;                // live transcript, for the UI
  onTranscriptCorrection(sent: string, actual: string): void;
  onBargeIn(): void;                            // confirmed — cut the agent
  onBargeInWarning(): void;                     // tentative — pause playback
  onBargeInRetracted(): void;                   // it was noise — resume
  onSpeechLikely(): void;                       // pre-open the TTS socket
  isAgentSpeaking(): boolean;
  getTurnContext(): TurnContextMessage[];
  onMetric(name: string, ms?: number, data?: Record<string, unknown>): void;
}
```

Note the barge-in triad — `onBargeInWarning` / `onBargeIn` / `onBargeInRetracted`
— is the state machine in §6 expressed as a contract. A design with one
`onBargeIn` callback cannot express "pause now, decide shortly", which is the
whole trick.

`onMetric` is not optional instrumentation. It is how §12.7 is satisfied.

```ts
// Per-caller orchestration — owns STT, agent, TTS, barge-in, playback.
new VoiceSession(id, {
  dispatchResearch(input: { request: string; messageId: string }): Promise<string>;
  send(msg: ServerMessage): void;     // JSON control frame to the client
  sendAudio(pcm: Uint8Array): void;   // raw PCM16 to the client
  metric(name: string, ms?: number, data?: Record<string, unknown>): void;
  elevenLabsApiKey: string; voiceId: string; ttsModel: string;
  frontModel?: string;                // per-room override, for A/B (§15)
  endpointing?: {
    vadSilenceMs?; vadThreshold?; vadPositive?; vadNegative?;
    farFieldRatio?; minHoldMs?; maxHoldMs?; vad?;
  };
});
```

`dispatchResearch` returning once **queued** — not once answered — is the
mechanism behind §7. If it awaited the result the room would go silent for the
duration of the lookup.

## 11. The client/server wire protocol

The entire contract between the audio duct and the room. Binary frames are raw
PCM16 in both directions; everything else is JSON.

```ts
type ClientMessage =
  | { t: "speaker"; speaker: SpeakerRole }        // who is at the mic
  | { t: "say"; speaker: SpeakerRole; text: string }  // type instead of talk
  | { t: "playback_done"; turnId: number }        // audio finished draining
  | { t: "barge_in" };                            // local VAD confirmed a voice

type ServerMessage =
  | { t: "ready"; sessionId; config; speakers; assistantName }
  | { t: "partial"; text: string }                // live transcript
  | { t: "utterance"; speaker: SpeakerRole; text: string }
  | { t: "speech"; turnId: number; text: string } // spoken span, streamed
  | { t: "speech_end"; turnId: number }
  | { t: "clear" }                                // drop every buffered sample
  | { t: "pause" }                                // stop, KEEP the buffer
  | { t: "resume" }                               // false alarm, carry on
  | { t: "state"; listening; speaking; thinking }
  | { t: "delegation"; jobId; phase; detail? }
  | { t: "metric"; name; ms?; data? }
  | { t: "error"; message: string };
```

Three things worth copying:

- **`pause` and `clear` are different messages.** `pause` stops playback and
  keeps the buffer; `clear` discards it. Collapsing them into one makes the
  free-if-wrong reflex in §6 impossible.
- **`say` exists.** Text injection down the same path as speech is what makes
  the agent testable without an audio stack (§16), and it costs one message type.
- **`playback_done` is an optimization, never a dependency.** The room derives
  playback end from bytes sent (§12.6); this just makes it exact when it arrives.

---

# Part II — Building it to last

## 12. Invariants

Load-bearing. Each exists because violating it produced a bug that took a live
call to find.

### 12.1 Audio always flows; the gate governs ownership

See §5. This is first because it is the one most likely to be undone as an
optimization.

### 12.2 Never feed the recognizer synthetic audio

Whisper-family models hallucinate confidently on digital silence — "Yes.",
"Thank you.", "Bye." Any keepalive sending zero-filled frames manufactures
utterances nobody spoke, arriving indistinguishable from real ones.

If a socket needs warming, send real captured audio or let it reconnect. The
only safe window for synthetic frames is when **no caller is attached**.

### 12.3 No single model gets a veto

| Model | Actually answers | Does **not** answer |
| --- | --- | --- |
| VAD | is there a voice in this 32 ms frame | is it *my caller's* voice |
| Recognizer | what words are in this audio | whether anyone meant to say them |
| EOU | does this text sound finished | whether more is coming |

Each is wrong in its own conditions. Design against **one silently overruling a
better-informed one** — which is exactly what happened when an acoustic
threshold tuned for turn boundaries was reused to decide whether a transcript was
real. Where two signals disagree, prefer the one with better evidence *for that
specific question*, and make the disagreement observable.

### 12.4 Compare transcripts by words, never by characters

Recognizers re-punctuate settled text indefinitely, at roughly 1 Hz:

```
"Okay. Okay, thanks."  →  "Okay. Okay. Thanks."  →  back again
```

Any check written on raw strings — *has the transcript stopped changing?*, *have
we already sent this?* — eventually fires on a moving comma instead of on speech.
One such check held a finished sentence unsent for **13 seconds**; another
dispatched the same line twice and had the agent answer itself.

Normalize to words for every comparison; slice on word boundaries and return the
recognizer's own punctuation for the remainder.

### 12.5 Stopping is free, committing is careful

See §6.

### 12.6 Every state that can mute the caller needs an owner and a deadline

A pause with no matching resume leaves the client buffering silently for the rest
of the call. So does a playback-complete signal that never arrives because the
tab was backgrounded.

Each such state needs (a) one function that exits it, called from every terminal
path, and (b) a server-side watchdog that fires without client cooperation — here
playback end is derived from bytes already sent, so a silent client cannot strand
the room.

### 12.7 A dropped transcript must be visible

The highest-value entry on this list. Discarding transcript text is invisible from
outside: the recognizer logs the words, the room silently declines them, and what
you observe is a **working recognizer attached to an agent that stopped
answering.**

Every drop path prints the decision and the numbers behind it:

```
[turn] dropped as phantom (sweep, no voice for 4109ms): "This is a"
[turn] dropped as far_field (stable, 0.0120 rms vs 0.0769 for this caller): "…"
[turn] VAD scored nothing for 10501ms while the recognizer kept hearing words — resetting it
```

Two production bugs were diagnosed from a single call log within minutes of these
being added. Each had previously cost several rounds of live testing.

## 13. Failure taxonomy

Symptom → cause → guard. All observed live; all pinned by a regression check.

### Listening stack

| Symptom | Cause | Fix / guard |
| --- | --- | --- |
| Recognizer transcribes fine, room ignores every word, nothing reaches the UI | Freshness gate keyed to the VAD at the *turn-boundary* threshold; a quiet or distant talker never clears it | Two witnesses: much lower acoustic bar, plus growing transcript as evidence in its own right (`quiet-talker-check`) |
| Finished sentence sits unsent for many seconds | Stillness measured on raw strings; re-punctuation resets the clock | Normalize to words (`commit-latency-check`) |
| Same line dispatched twice; agent answers itself | Dedupe compared characters; a re-punctuated echo matched neither equality nor prefix, so it looked like fresh speech | Word-sequence prefix logic (`dedupe-check`) |
| Room goes deaf mid-call, never recovers, caller must hang up | Recurrent VAD state went bad; the gap-based reset can't fire because full duplex means audio never stops arriving | Watchdog: new words + no acoustic evidence for 10 s ⇒ reset the model (`commit-latency-check`) |
| Utterances nobody spoke | Synthetic silence keepalive fed to the recognizer | §12.2 |
| Two utterances glued together across callers | The recognizer's partial buffer is session-scoped, not connection-scoped, and survives detach | Commit the stale buffer on detach, mark it already-dispatched |
| Next table's conversation transcribed as the caller | No model in the stack answers "is this my caller" | Loudness relative to the caller's own learned level (`far-field-check`) |

### Barge-in

| Symptom | Cause | Fix / guard |
| --- | --- | --- |
| Agent pauses, then resumes the same sentence, ignoring the interruption | VAD scored the echo-mangled interruption a misfire and retracted a correct pause | Transcript growth overrules the retraction (`barge-escalation-check`) |
| After one interruption the room never responds again | Pause with no resume path; client stayed muted | Single exit function + byte-derived playback watchdog |
| Client's barge-in signal arrives after the agent already finished | Race, unavoidable | Decline gracefully with an explicit resume — never leave the client waiting |

### Process safety

| Symptom | Cause | Fix / guard |
| --- | --- | --- |
| Host process dies on a transient vendor 5xx | Auto-reconnect called an async function with no `.catch()`; unhandled rejection | Catch at every reconnect site; add a supervised revive loop |
| Stack overflow tearing down a speech socket | `destroy()` fires the socket's `error` event **synchronously**, whose handler tears down again | Clear references *before* destroying |
| Recognizer silently keeps buffering after an explicit commit | Vendor throttles commits under ~0.3 s of uncommitted audio; the rejection is invisible | Pad the flush past the vendor's floor |

### The agent

| Symptom | Cause | Fix / guard |
| --- | --- | --- |
| Agent greets a throat-clear, answers a mis-transcription, replies to the next table | Nothing told it the transcript is an unreliable witness | Prompt: silence is the most-used response, not a fallback |
| Agent repeats a price the *customer* invented as though the business quoted it | Nothing distinguished "heard" from "known" | Only tool-sourced facts exist |
| One unclear word resolved into a confident proper noun | Model filling a gap plausibly | Ask; never resolve |

## 14. What is demo-grade in the reference implementation

Read before shipping. None are hidden; all are deliberate simplifications.

**The room WebSocket is unauthenticated.** Anything that can reach the port can
attach to the call, and a second connection *replaces* the first. Production
needs a per-room capability token minted with the room and verified on upgrade.
The most important gap here.

**Transcripts live in memory and die with the process.** No persistence, no
resume after a crash, no record of the call. If your product needs history — most
do, some are legally required to keep it — that is a real store and schema.

**Metrics append to a local file.** Fine for one host, useless across a fleet.
Note the drop warnings in §12.7 contain **caller speech**: treat them as user data
when routing logs, and consider truncating or hashing.

**Ports are allocated by probing for a free one.** Races under concurrency. Use a
real allocator, or terminate every room on one multiplexed gateway and route by
room id.

**One vendor key for everything.** No per-tenant quota, attribution or isolation.
Multi-tenant needs at minimum a spend cap per room — a stuck room is a metered
socket held open.

**Capacity is a slot count per host (default 4).** Each room is a process holding
an ONNX model and two vendor sockets. Plan against process count and model
memory, not request rate.

**Nothing handles recording consent or data residency.** Voice is regulated
differently from text in many jurisdictions — a launch decision, not a retrofit.

**Cold start is real.** The EOU model takes ~1.3 s to load. Rooms warm it before
the caller attaches; spawn-on-demand pays it on the first call unless pre-warmed.

## 15. Tuning surface

All server-side — most of the point of hosting the pipeline there.

| Knob | Default | Raise when | Lower when |
| --- | --- | --- | --- |
| `VAD_POSITIVE` / `VAD_NEGATIVE` | 0.35 / 0.25 | False starts in a noisy room | The caller must raise their voice to be heard |
| `VAD_SILENCE_MS` | 450 | Callers cut off mid-thought | Turns feel sluggish |
| `TURN_MIN_HOLD_MS` | 400 | — | Rarely — it sits deliberately above VAD resume detection so a fast follow-on can cancel a commit in flight |
| `TURN_MAX_HOLD_MS` | 2800 | Deliberate, pausing speakers | Callers wait too long after finishing |
| `FAR_FIELD_RATIO` | 0.25 | Stricter in a crowd (→0.4) | A soft-spoken caller is cut (→0.1); `0` disables |
| `FRONT_MODEL` | fast tier | — | See §16 |
| `FRONT_PROVIDER_SORT` | throughput | — | Measured 6× TTFT difference on identical weights |
| `ROOM_SLOTS` / `ROOM_MAX_MS` | 4 / 1 h | Capacity planning | — |

The client keeps exactly one knob: microphone **AGC, default off**. Automatic
gain control exists to make every voice arrive at the same level, and relative
level is the only cue separating the caller from the room around them.

## 16. Choosing the front model

The front agent's job is judgment under time pressure: decide whether a line was
even addressed to it, and start speaking fast enough to feel conversational.
Those goals are in tension — measure rather than assume.

A rubric harness runs cases taken from real call transcripts over the room's own
text-injection path, scoring **silence** (correctly saying nothing) separately
and weighting it hardest, because an agent talking over a room it misheard is the
failure callers feel most.

| Model | Silence | First spoken token |
| --- | --- | --- |
| Fast tier (Groq-served) | 2/5 | **313 ms** |
| Mid tier | 4/5 | 1853 ms |
| Strong tier | 5/5 | 3213 ms |

Two findings that generalize:

- **A better prompt does not fix a model that won't follow it.** The defensive
  prompt barely moved the fast model's score, and produced near-verbatim intended
  behaviour on a stronger one.
- **Serving matters more than weights for latency.** Most of that spread is
  provider availability, not capability.

Rooms accept a per-run model override so candidates can be A/B'd without a
restart.

## 17. Testing what a simulator cannot reach

Most bugs in §13 are invisible to end-to-end audio tests, structurally:
**attenuating clean synthesized speech is not the same as a real room.** At 4 %
gain the VAD still scores synthesized speech 0.999 — the condition that broke
production does not exist in the simulation.

So the suite has two layers:

**Logic checks** drive the engine directly with a fake recognizer and a
hand-driven VAD, reproducing conditions a microphone cannot be made to produce on
demand: a VAD that never fires a boundary, a recognizer that re-punctuates
forever, a VAD that dies mid-call. Each was verified to **fail against the
previous engine** — that is what makes it a regression test rather than a
description.

**Live sims** stream real synthesized speech into a real room and measure
end-to-end: commit latency, voice-to-voice, barge-in, phantom counts over
silence.

Port the logic checks first. They are the cheap layer and they cover the
expensive bugs.

## 18. If you remember four things

1. **Audio always flows; gate ownership, not the microphone.**
2. **Compare words, not characters** — recognizers re-punctuate forever.
3. **Make every drop loud**, or you will debug a working recognizer attached to a
   mute agent.
4. **Being ignored is worse than overhearing.** Every guard here is tuned to err
   toward hearing the caller — including the ones that recover automatically once
   they notice they have been wrong for too long.

---

# Appendix — Source map

Where each concept in this document lives in the reference implementation.
Line counts are a rough guide to where the complexity actually sits.

| File | Lines | Implements | Section |
| --- | --- | --- | --- |
| `lib/turn-engine.ts` | 1097 | The commitment engine: four commit paths, four guards, the full-duplex gate, barge-in escalation | §4, §5, §12 |
| `lib/voice-session.ts` | 1094 | Per-caller orchestration: STT lifecycle + revival, agent turn, TTS streaming, playback watchdog, pause/resume ownership | §6, §12.6 |
| `web/app/lib/useRoom.ts` | 497 | The entire client. Capture, playback, optional reflex VAD, local pause. Holds no keys, makes no decisions | §2 |
| `signals/room.ts` | 350 | Room lifecycle: audio WebSocket, input schema (the tuning surface), inbound mesh replies, graceful shutdown | §15 |
| `lib/silero-vad-node.ts` | 249 | Neural VAD via `onnxruntime-node`; the tentative/confirmed/misfire state machine and ducking while the agent speaks | §9 |
| `lib/mesh-transport.ts` | 177 | The two adapters that let delegation span a process boundary | §7 |
| `lib/speech-parser.ts` | 164 | Incremental tag parser — decides which model tokens are speech, mid-stream, when tags split across chunks | §7 |
| `lib/turn-detector-local.ts` | 124 | End-of-utterance scoring in-process, plus the heuristic fallback and the hold curve | §4 |
| `lib/front-agent.ts` | 129 | The conversational agent and its defensive prompt | §13 |
| `lib/models.ts` | 117 | Per-role model selection, reasoning effort, provider routing | §16 |
| `lib/protocol.ts` | 98 | The whole client/server contract | §11 |

## Regression checks

Pure-logic drivers — no audio stack, no network. Each was verified to fail
against the engine that had the bug (§17).

| Check | Pins |
| --- | --- |
| `scripts/quiet-talker-check.ts` | A quiet or far talker is heard; a dead-room hallucination still is not |
| `scripts/commit-latency-check.ts` | Re-punctuation doesn't stall a commit; a deaf VAD gets reset |
| `scripts/dedupe-check.ts` | Re-punctuated echo sends once; a real repeat still sends twice |
| `scripts/far-field-check.ts` | The next table is rejected; a caller who moves or mutters is not locked out |
| `scripts/barge-escalation-check.ts` | A pause survives a VAD that calls the interruption a misfire |

## Live harnesses

Require credentials and a running room.

| Script | Measures |
| --- | --- |
| `scripts/voice-sim.mjs` | Real synthesized speech into a real room: commit latency, voice-to-voice, barge-in, phantom counts over silence. Flags: `--barge-in`, `--silence`, `--conversation`, `--gain=` |
| `scripts/front-eval.mjs` | The agent-judgment rubric (§16), over the protocol's `say` path |
| `scripts/vad-gain-check.ts` | The gain floor at which the VAD stops confirming speech |
