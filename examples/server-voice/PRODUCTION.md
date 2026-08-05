# Taking this to production

A design document for engineers adapting the server-hosted room pattern to a
real product. The [README](./README.md) explains *why the pipeline sits where it
does*. This explains **what must stay true when you rebuild it**, what breaks
if it doesn't, and what in this example is demo-grade and has to be replaced.

Everything in the failure taxonomy below was found by debugging real calls, not
by reasoning about the design. Each one is cheap to re-introduce and expensive
to diagnose, because almost all of them present identically from the caller's
side: *the room stopped listening to me.*

---

## 1. The shape, in one paragraph

A **room** is one conversation, owned by one process. It holds the microphone
socket, the VAD, the recognizer socket, the endpointing decision, the agent, and
the speech synthesis socket. The client captures audio and plays audio; it makes
no decisions. Heavy or slow work (database lookups, research) is delegated to a
separate process and answered asynchronously, so the conversation never blocks
on it.

That much is portable. The rest of this document is about the parts that look
optional and aren't.

---

## 2. Invariants

These are load-bearing. Each one exists because violating it produced a bug that
took a live call to find.

### 2.1 Audio always flows. The gate governs *ownership*, not the microphone.

It is tempting to stop sending audio to the recognizer while the agent is
speaking — it saves money and it "obviously" prevents the agent hearing itself.
Don't.

The moment you do, the room is half-duplex and **the caller cannot interrupt
with words**, only with noise. Worse, the recognizer's socket goes idle and its
buffer state drifts out of sync with what you think it holds.

Keep audio flowing to everything, always. What changes while the agent speaks is
whether transcript text is *allowed to dispatch* — and what happens to text that
accumulated during her turn: it is either claimed by a confirmed interruption or
discarded when her turn ends unclaimed.

### 2.2 Never feed the recognizer synthetic audio.

Whisper-family models hallucinate confidently on digital silence — "Yes.",
"Thank you.", "Bye." Any keepalive that sends zero-filled frames will manufacture
utterances that no one spoke, and they arrive looking exactly like real ones.

If a socket needs keeping warm, send real captured audio, or let it close and
reconnect. This example's keepalive only fires when **no caller is attached**,
and that is the only safe window for it.

### 2.3 No single model gets a veto.

The pipeline contains several models that answer different questions:

| model | actually answers | does **not** answer |
| --- | --- | --- |
| VAD (Silero) | is there a voice in this 32ms frame | is it *my caller's* voice |
| recognizer | what words are in this audio | whether anyone meant to say them |
| end-of-utterance | does this text sound finished | whether more is coming |

Each is wrong in its own way and in its own conditions. The failure mode to
design against is **one of them silently overruling a better-informed one** —
which is exactly what happened when an acoustic threshold tuned for turn
boundaries was reused to decide whether a transcript was real.

Where two signals disagree, prefer the one with better evidence for *that
specific question*, and make the disagreement observable.

### 2.4 Compare transcripts by words, never by characters.

Recognizers re-punctuate text they have already settled on, indefinitely, at
about 1 Hz:

```
"Okay. Okay, thanks."  →  "Okay. Okay. Thanks."  →  back again
```

Any check written on raw strings — "has the transcript stopped changing?", "have
we already sent this?" — eventually fires on a moving comma instead of on
speech. One such check held a finished sentence unsent for **13 seconds**;
another dispatched the same line twice and had the agent answer itself.

Normalize to words for every comparison. Slice on word boundaries and return the
recognizer's own punctuation for the remainder.

### 2.5 Stopping is free. Committing is careful.

Barge-in is two decisions, not one:

1. **Pause playback** on the first hint of a voice — tens of milliseconds in,
   before it could possibly be confirmed. Being wrong costs nothing; playback
   resumes where it left off.
2. **Cut the turn** only once there is evidence: a confirmed VAD start, or —
   better in a real room — *words appearing in the transcript while the agent
   holds the floor*.

Transcript growth is the stronger witness, because echo cancellation mangles the
caller's audio badly enough that a genuine interruption is often scored as noise.
Measured here: 85–128ms to pause, resolved either way within a few hundred more.

### 2.6 Every state that mutes the caller needs an owner and a deadline.

A pause with no matching resume leaves the client buffering silently for the
rest of the call. So does a playback-complete signal that never arrives because
the client tab was backgrounded.

Every such state needs (a) a single function that exits it, called from every
terminal path, and (b) a server-side watchdog that fires without client
cooperation — here, playback end is derived from the byte count already sent, so
a silent client cannot strand the room.

### 2.7 A dropped transcript must be visible.

This is the one that would have saved the most time. Discarding transcript text
is invisible from outside: the recognizer logs the words, the room silently
declines them, and what you observe is a *working recognizer attached to an
agent that stopped answering.*

Every drop path prints the decision and the numbers behind it:

```
[turn] dropped as phantom (sweep, no voice for 4109ms): "This is a"
[turn] dropped as far_field (stable, 0.0120 rms vs 0.0769 for this caller): "…"
[turn] VAD scored nothing for 10501ms while the recognizer kept hearing words — resetting it
```

Two production bugs were diagnosed from a single call log within minutes of
adding these. Before them, the same bugs took several rounds of live testing
each.

---

## 3. Failure taxonomy

Symptom → cause → guard. All observed live; all pinned by a check.

### The listening stack

| Symptom | Cause | Fix / guard |
| --- | --- | --- |
| Recognizer transcribes fine, room ignores every word, nothing reaches the UI | Freshness gate keyed to the VAD at the *turn-boundary* threshold; a quiet or distant talker never clears it | Two witnesses: a much lower acoustic bar, plus growing transcript as evidence in its own right (`quiet-talker-check`) |
| Finished sentence sits unsent for many seconds | Stillness measured on raw strings; re-punctuation resets the clock | Normalize to words (`commit-latency-check`) |
| Same line dispatched twice; agent answers itself | Buffer dedupe compared characters; re-punctuated echo matched neither equality nor prefix, so it looked like fresh speech | Word-sequence prefix logic (`dedupe-check`) |
| Room goes deaf mid-call and never recovers; caller must hang up | Recurrent VAD state went bad. The gap-based reset can't fire because full duplex means audio never stops arriving | Watchdog: new words + no acoustic evidence for 10s ⇒ reset the model (`commit-latency-check`) |
| Utterances no one spoke ("Yes.", "Thank you.") | Synthetic silence keepalive fed to the recognizer | Never synthesize audio into STT (§2.2) |
| Two utterances glued together across callers | Recognizer's partial buffer is session-scoped, not connection-scoped; it survives detach | Commit the stale buffer on detach and mark it already-dispatched |
| Next table's conversation transcribed as the caller | No model in the stack answers "is this my caller" | Loudness relative to the caller's own learned level (`far-field-check`) |

### Barge-in

| Symptom | Cause | Fix / guard |
| --- | --- | --- |
| Agent pauses, then resumes the same sentence, ignoring the interruption | VAD scored the echo-mangled interruption a misfire and retracted a correct pause | Transcript growth overrules the VAD retraction (`barge-escalation-check`) |
| After one interruption the room never responds again | Pause with no resume path; client stayed muted | Single `liftPause()` exit + byte-derived playback watchdog |
| Client's barge-in signal arrives after the agent already finished | Race, unavoidable | Decline gracefully with an explicit `resume` — never leave the client waiting |

### Process safety

| Symptom | Cause | Fix / guard |
| --- | --- | --- |
| Host process dies on a transient provider 5xx | Reconnect called an async function with no `.catch()`; rejection went unhandled | Catch at every auto-reconnect site; add a supervised revive loop |
| Stack overflow tearing down a speech socket | `destroy()` fires the socket's `error` event *synchronously*, whose handler tears down again | Clear references **before** destroying |
| Recognizer silently keeps buffering after an explicit commit | Provider throttles commits under ~0.3s of uncommitted audio; the rejection is invisible | Pad the flush past the provider's floor |

### The agent

| Symptom | Cause | Fix / guard |
| --- | --- | --- |
| Agent greets a throat-clear, answers a mis-transcription, replies to the next table | Nothing told it the transcript is an unreliable witness | Defensive prompt section: silence is the most-used response |
| Agent repeats a price the *customer* invented as though the shop quoted it | Nothing distinguished "heard" from "known" | Explicit rule: only worker-sourced numbers exist |
| One unclear word resolved into a confident proper noun | Model filling a gap plausibly | Explicit rule: ask, never resolve |

---

## 4. What is demo-grade here

Read this section before shipping anything. None of these are hidden; all of
them are deliberate simplifications for an example.

**The room WebSocket is unauthenticated.** Anything that can reach the port can
attach to the call, and a second connection *replaces* the first. Production
needs a per-room capability token minted alongside the room and verified on
upgrade. This is the single most important gap on the list.

**Transcripts live in memory and die with the process.** Each session uses an
in-memory store. There is no persistence, no resume after a crash, no transcript
of record. If your product needs call history — most do, and some are legally
required to keep it — that is a real store and a schema, not a config change.

**Metrics append to a local JSONL file.** Fine for one host, useless across a
fleet. Ship structured events to whatever you already run. Note that the drop
warnings in §2.7 contain **caller speech** — treat them as user data when you
route logs, and consider truncating or hashing in production.

**Ports are allocated by probing for a free one.** That races under concurrency.
Use a real allocator, or terminate all rooms on one multiplexed gateway and
route by room id.

**One provider key for everything.** No per-tenant quota, attribution, or
isolation. Multi-tenant products need at minimum a spend cap per room, because a
stuck room is a metered socket held open.

**Capacity is `ROOM_SLOTS` per host, defaulting to 4.** Each room is a process
holding an ONNX model and two provider sockets. Plan against process count and
model memory, not request rate.

**Nothing handles recording consent or data residency.** Voice is regulated
differently from text in many jurisdictions. That is a product decision that has
to be made before launch, not retrofitted.

**Cold start is real.** The end-of-utterance model takes ~1.3s to load. This
example warms it at room start, before the caller attaches; a pool that spawns
rooms on demand pays it on the first call unless you pre-warm.

---

## 5. The tuning surface

All server-side, all changeable without a client deploy — which is most of the
point of hosting the pipeline server-side.

| Knob | Default | Raise it when | Lower it when |
| --- | --- | --- | --- |
| `VAD_POSITIVE` / `VAD_NEGATIVE` | 0.35 / 0.25 | False starts in a noisy room | The caller has to raise their voice to be heard |
| `VAD_SILENCE_MS` | 450 | Callers get cut off mid-thought | Turns feel sluggish |
| `TURN_MIN_HOLD_MS` | 400 | — | Rarely; it sits deliberately above VAD resume detection so a fast follow-on can still cancel a commit in flight |
| `TURN_MAX_HOLD_MS` | 2800 | Deliberate, pausing speakers | Callers wait too long after finishing |
| `FAR_FIELD_RATIO` | 0.25 | Stricter in a crowd (→0.4) | A soft-spoken caller is being cut (→0.1); `0` disables |
| `FRONT_MODEL` | fast tier | — | See §6 |
| `FRONT_PROVIDER_SORT` | `throughput` | — | Measured 6× TTFT difference on identical weights |
| `ROOM_SLOTS` / `ROOM_MAX_MS` | 4 / 1h | Capacity planning | — |

The client keeps exactly one knob, `NEXT_PUBLIC_MIC_AGC`, default **off**.
Automatic gain control is disabled deliberately: it exists to make every voice
arrive at the same level, and relative level is the only cue that separates the
caller from the room around them.

---

## 6. Choosing the front model

The front agent's job is judgment under time pressure: decide whether a line was
even addressed to it, and start speaking fast enough to feel like a
conversation. Those two goals are in direct tension, and the trade is worth
measuring rather than assuming.

`scripts/front-eval.mjs` runs a rubric of cases taken from real call
transcripts, over the room's own text-injection path. It scores **silence**
(correctly saying nothing) separately and weights it hardest, because an agent
talking over a room it misheard is the failure callers feel most.

Measured on the same prompt, same rubric:

| model | silence | first spoken token |
| --- | --- | --- |
| fast tier (Groq-served) | 2/5 | **313 ms** |
| mid tier | 4/5 | 1853 ms |
| strong tier | 5/5 | 3213 ms |

Two things that generalize:

- **A better prompt does not fix a model that won't follow it.** The defensive
  prompt barely moved the score on the fast model and produced near-verbatim
  intended behaviour on a stronger one.
- **Serving matters more than weights for latency.** Most of the spread above is
  provider availability, not model capability.

Run the rubric against your own candidates before picking. Rooms accept a
`frontModel` input so you can A/B without restarting anything.

---

## 7. Testing what a simulator cannot reach

Most of the bugs in §3 are invisible to an end-to-end audio test, for a
structural reason: **attenuating clean synthesized speech is not the same as a
real room.** At 4% gain the VAD still scores synthesized speech 0.999 — the
condition that broke production doesn't exist in the simulation.

So the suite is in two layers:

**Logic checks** drive the engine directly with a fake recognizer and a
hand-driven VAD. They reproduce field conditions a microphone can't be made to
produce on demand — a VAD that never fires a boundary, a recognizer that
re-punctuates forever, a VAD that goes dead mid-call. Each check was verified to
**fail against the previous engine**, which is what makes it a regression test
rather than a description.

**Live sims** stream real synthesized speech into a real room and measure
end-to-end behaviour: commit latency, voice-to-voice, barge-in, and phantom
counts over silence.

When you adapt this, port the logic checks first. They are the cheap ones and
they cover the expensive bugs.

---

## 8. If you remember four things

1. **Audio always flows; gate ownership, not the microphone.**
2. **Compare words, not characters** — recognizers re-punctuate forever.
3. **Make every drop loud**, or you will debug a working recognizer attached to
   a mute agent.
4. **Being ignored is worse than overhearing.** Every guard here is tuned so
   that when it is wrong, it errs toward hearing the caller — including the ones
   that recover automatically when they notice they've been wrong for too long.
