// Talk to a room with REAL speech, and measure what happens.
//
// Everything up to now was tested with typed input or synthetic tones. Neither
// exercises the parts that were failing: typed input skips the VAD entirely,
// and a synthetic vowel is too static for Silero to score as sustained speech.
// So this synthesizes actual speech with ElevenLabs, streams it into the room
// at realtime as if it were a microphone, and reports the timings that matter.
//
//   PORT=4501 node scripts/voice-sim.mjs                 # measure turn latency
//   PORT=4501 node scripts/voice-sim.mjs --barge-in      # test interruption
//   PORT=4501 node scripts/voice-sim.mjs --conversation  # several turns, one connection
//
// Turn latency here is the honest number: from the last sample of speech to
// the moment the room commits the utterance to the agent.

import WebSocket from "ws";
import { config as loadEnv } from "dotenv";
import path from "node:path";

loadEnv({ path: [path.join(import.meta.dirname, "..", ".env.local")], quiet: true });

const PORT = process.env.PORT ?? 4501;
const BARGE_IN = process.argv.includes("--barge-in");
const CONVERSATION = process.argv.includes("--conversation");
// Attenuate the mic, as the browser's echo canceller does while the agent's
// audio plays (measured ducking is 10-30x). --gain 0.05 is a realistic
// barge-in as the room actually receives it.
const GAIN = Number(process.argv.find((a) => a.startsWith("--gain="))?.slice(7) ?? 1);
const KEY = process.env.ELEVENLABS_API_KEY;
const VOICE = "JBFqnCBsd6RMkjVDRZzb"; // a different voice than Nova's
const LINE = process.argv.find((a) => !a.startsWith("--") && a.includes(" "))
  ?? "Nova, is hull KES zero zero zero seven still under warranty?";

if (!KEY) throw new Error("ELEVENLABS_API_KEY not set (put it in .env.local)");

/** Synthesize a phrase to 16kHz PCM16 — the format the room expects. */
async function speech(text) {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=pcm_16000`,
    {
      method: "POST",
      headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: "eleven_flash_v2_5" }),
    },
  );
  if (!res.ok) throw new Error(`TTS ${res.status}: ${await res.text()}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const at = () => `${String(Date.now() - t0).padStart(6)}ms`;

console.log(`synthesizing: "${LINE}"${GAIN !== 1 ? ` at gain ${GAIN}` : ""}`);
const pcm = await speech(LINE);
if (GAIN !== 1) for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(pcm[i] * GAIN);
console.log(`${(pcm.length / 16000).toFixed(2)}s of speech\n`);

const ws = new WebSocket(`ws://localhost:${PORT}`);
ws.binaryType = "arraybuffer";

let audioEndedAt = 0;
let clearedAt = 0;
let novaAudioAt = 0;
let novaSpeaking = false;
let novaRepliedAt = 0;
let lastNovaAudioAt = 0;
let audioAfterClear = 0;
let speechAfterClear = 0;
let committedAfterClear = false;
let turnAudioBytes = 0;
let turnFirstAudioAt = 0;
const state = { partials: 0 };
let onUtterance = () => {};

ws.on("message", (data, isBinary) => {
  if (isBinary) {
    if (!novaAudioAt) novaAudioAt = Date.now();
    novaSpeaking = true;
    lastNovaAudioAt = Date.now();
    // Only audio in the window between the cut and the NEXT committed
    // utterance can be the interrupted line resuming. Anything after that
    // commit is her answering what was just said, which is the point.
    if (clearedAt && !committedAfterClear) audioAfterClear += data.byteLength ?? data.length;
    if (!turnFirstAudioAt) turnFirstAudioAt = Date.now();
    turnAudioBytes += data.byteLength ?? data.length;
    return;
  }
  const m = JSON.parse(data.toString());
  switch (m.t) {
    case "ready":
      console.log(`${at()} ready — vad=${m.config?.vad} ${m.config?.endpointing ?? ""}`);
      break;
    case "partial":
      state.partials++;
      break;
    case "utterance":
      if (clearedAt) committedAfterClear = true;
      onUtterance(m.text);
      console.log(
        `${at()} COMMITTED "${m.text}"` +
          (audioEndedAt ? `  ← ${Date.now() - audioEndedAt}ms after speech ended` : ""),
      );
      break;
    case "speech":
      if (clearedAt && !committedAfterClear) speechAfterClear += m.text.length;
      if (!novaRepliedAt && audioEndedAt) {
        novaRepliedAt = Date.now();
        console.log(`${at()} NOVA REPLIES  ← ${novaRepliedAt - audioEndedAt}ms after speech ended`);
      }
      break;
    case "speech_end": {
      // Behave like the browser: report the turn drained — but only when the
      // audio would actually have FINISHED PLAYING. The room streams faster
      // than realtime, so acking instantly tells it the caller went quiet
      // while the speakers are still going, which quietly disables barge-in
      // for the rest of the turn. pcm_16000 is 32000 bytes per second.
      const playbackEndsAt = turnFirstAudioAt + turnAudioBytes / 32;
      const turnId = m.turnId;
      // A turn voided by barge-in never sends speech_end, so every turn that
      // reaches here deserves its ack once its audio would have drained.
      setTimeout(() => {
        ws.send(JSON.stringify({ t: "playback_done", turnId }));
        turnAudioBytes = 0;
        turnFirstAudioAt = 0;
      }, Math.max(0, playbackEndsAt - Date.now()));
      break;
    }
    case "clear":
      clearedAt = Date.now();
      turnAudioBytes = 0;
      turnFirstAudioAt = 0;
      console.log(
        `${at()} CLEAR` +
          (audioEndedAt ? ` — interrupted after ${clearedAt - audioEndedAt}ms of talking over her` : ""),
      );
      break;
    case "metric":
      if (["endpoint_hold", "stt_dispatch_ms", "stt_phantom_dropped", "barge_in"].includes(m.name)) {
        console.log(`${at()}   ${m.name}${m.ms != null ? ` ${m.ms}ms` : ""} ${JSON.stringify(m.data ?? {})}`);
      }
      break;
    case "error":
      console.log(`${at()} ERROR ${m.message}`);
      break;
  }
});

/** Stream PCM in 20ms frames, exactly as the browser worklet does. */
async function streamSpeech(samples) {
  for (let i = 0; i + 320 <= samples.length; i += 320) {
    ws.send(Buffer.from(samples.buffer, samples.byteOffset + i * 2, 640));
    await sleep(20);
  }
}

/** Room tone, so the VAD sees a normal noise floor rather than digital silence. */
async function streamQuiet(seconds) {
  const frames = Math.floor((seconds * 1000) / 20);
  for (let i = 0; i < frames; i++) {
    const q = new Int16Array(320);
    for (let n = 0; n < q.length; n++) q[n] = Math.round((Math.random() * 2 - 1) * 60);
    ws.send(Buffer.from(q.buffer));
    await sleep(20);
  }
}

ws.on("open", async () => {
  await sleep(600);

  if (BARGE_IN) {
    console.log(`${at()} asking a question to get her talking…`);
    ws.send(JSON.stringify({ t: "say", speaker: "operator", text: "Tell me about the Kestrel L2 hauler in detail." }));

    // Wait until her audio is actually playing.
    const deadline = Date.now() + 20_000;
    while (!novaSpeaking && Date.now() < deadline) await sleep(100);
    if (!novaSpeaking) {
      console.log("she never started speaking — cannot test barge-in");
      process.exit(1);
    }
    console.log(`${at()} she is speaking — talking over her now`);
    audioEndedAt = Date.now(); // reused as "started talking over her"
    await streamSpeech(pcm);
    await sleep(4000);

    // Being cut off is only half of it. The model keeps streaming text for a
    // turn whose audio was killed, and the real failure is her RESUMING a
    // moment later — which is what "cannot interrupt" feels like.
    console.log(`\ncleared            : ${clearedAt ? "yes" : "NO"}`);
    console.log(`audio before next turn : ${audioAfterClear} bytes (want 0 — the cut line resuming)`);
    console.log(`speech before next turn: ${speechAfterClear} chars`);
    const ok = clearedAt && audioAfterClear === 0;
    console.log(
      `\n${ok ? "PASS — cut off and stayed stopped" : "FAIL — she resumed the interrupted line"}`,
    );
    ws.close();
    process.exit(ok ? 0 : 1);
  }

  if (CONVERSATION) {
    // One connection, several turns. Single-utterance runs never exercised the
    // state a turn leaves behind, which is where turn-taking was seen to stop
    // dead after the first couple of exchanges.
    const lines = [
      "Hello. How are you?",
      "I need some help with something.",
      "Hello?",
      "Hello?",
      "Hello?",
    ];
    let committed = 0;
    onUtterance = () => committed++;
    await streamQuiet(0.6);
    for (const [i, line] of lines.entries()) {
      const clip = await speech(line);
      console.log(`${at()} — saying "${line}"`);
      const before = committed;
      await streamSpeech(clip);
      audioEndedAt = Date.now();
      await streamQuiet(6);
      console.log(
        `${at()}   → ${committed > before ? "committed" : "*** NOTHING COMMITTED ***"} (${committed}/${i + 1} so far)`,
      );
    }
    console.log(`\n${committed}/${lines.length} utterances committed`);
    ws.close();
    process.exit(committed === lines.length ? 0 : 1);
  }

  await streamQuiet(0.6);
  console.log(`${at()} speaking…`);
  await streamSpeech(pcm);
  audioEndedAt = Date.now();
  console.log(`${at()} …stopped. waiting for the room to commit the turn`);
  await streamQuiet(8);

  if (novaAudioAt && audioEndedAt) {
    console.log(
      `\nvoice-to-voice: ${novaAudioAt - audioEndedAt}ms (you stop → her audio starts)`,
    );
  }
  console.log(`${state.partials} partial updates seen`);
  ws.close();
  process.exit(0);
});

ws.on("error", (e) => {
  console.error("socket error:", e.message);
  process.exit(1);
});
