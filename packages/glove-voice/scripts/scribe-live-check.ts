// Live check for the ElevenLabs Scribe v3 integration.
//
//   ELEVENLABS_API_KEY=... pnpm --filter glove-voice scribe:check [clip.wav]
//
// Runs a two-speaker clip through Scribe v3 Live (realtime) with the real
// `ElevenLabsSTTAdapter`, then through batch Scribe v3, and reports whether
// the API behaves the way the adapter expects: turn probabilities, speaker
// labels (draft and settled), how long settled labels take, and any message
// type the adapter does not know. A second realtime pass turns timestamps on
// and checks that every commit arrives as one plain and one timed event.
//
// Without a clip it synthesizes one with two ElevenLabs voices (uses a few
// credits). A clip must be 16 kHz mono 16-bit, WAV or raw PCM.
//
// Needs Node 22+ (global WebSocket) and a network that allows WebSockets.

import { readFileSync } from "node:fs";
import { ElevenLabsSTTAdapter } from "../src/adapters/eleven-labs/stt";
import { transcribeWithElevenLabs } from "../src/adapters/eleven-labs/batch";
import { SpeakerTracker } from "../src/speakers";

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error("Set ELEVENLABS_API_KEY.");
  process.exit(1);
}
const API = "https://api.elevenlabs.io";
const RATE = 16_000;
console.debug = () => {};

// ─── The clip ──────────────────────────────────────────────────────────────

const silence = (ms: number) => Buffer.alloc(Math.round((ms / 1000) * RATE) * 2);

async function speak(voiceId: string, text: string): Promise<Buffer> {
  const res = await fetch(`${API}/v1/text-to-speech/${voiceId}?output_format=pcm_16000`, {
    method: "POST",
    headers: { "xi-api-key": apiKey!, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: "eleven_flash_v2_5" }),
  });
  if (!res.ok) throw new Error(`TTS failed (${res.status}): ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

async function loadClip(): Promise<Buffer> {
  const path = process.argv[2];
  if (path) {
    const file = readFileSync(path);
    return file.subarray(0, 4).toString() === "RIFF" ? wavData(file) : file;
  }
  console.log("Synthesizing a two-voice clip...");
  const a = "JBFqnCBsd6RMkjVDRZzb";
  const b = "XB0fDUnXU5powFXDhCwa";
  return Buffer.concat([
    await speak(a, "Hi, I'd like to book a table for seven people tomorrow evening, please."),
    silence(700),
    await speak(b, "Actually, make it seven thirty. And can we sit by the window?"),
    silence(900),
    await speak(a, "Yes, the window would be great. My phone number is four one five, five five five, zero one two three."),
    silence(2500),
  ]);
}

/** The payload of a WAV file's `data` chunk. Headers vary, so walk the chunks. */
function wavData(file: Buffer): Buffer {
  let at = 12; // past "RIFF", size, "WAVE"
  while (at + 8 <= file.length) {
    const id = file.subarray(at, at + 4).toString();
    const size = file.readUInt32LE(at + 4);
    if (id === "data") return file.subarray(at + 8, Math.min(at + 8 + size, file.length));
    at += 8 + size + (size % 2); // chunks are padded to an even length
  }
  throw new Error("No data chunk found in the WAV file.");
}

function toWav(pcm: Buffer): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

// ─── Realtime: Scribe v3 Live ──────────────────────────────────────────────

const KNOWN = new Set([
  "session_started",
  "partial_transcript",
  "committed_transcript",
  "committed_transcript_with_timestamps",
  "diarized_transcript",
  "speakers_merged",
  "warning",
  "commit_throttled",
  "insufficient_audio_activity",
]);

async function getToken(): Promise<string> {
  const res = await fetch(`${API}/v1/single-use-token/realtime_scribe`, {
    method: "POST",
    headers: { "xi-api-key": apiKey! },
  });
  if (!res.ok) throw new Error(`token failed (${res.status}): ${await res.text()}`);
  return ((await res.json()) as { token: string }).token;
}

/** Send the clip in real time, 100ms at a time, then wait for the last events. */
async function stream(stt: ElevenLabsSTTAdapter, pcm: Buffer) {
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
  for (let i = 0; i < samples.length; i += 1600) {
    stt.sendAudio(samples.subarray(i, Math.min(i + 1600, samples.length)));
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, 3000));
}

const check = (ok: boolean, label: string) => console.log(ok ? "  ok  " : "  ??  ", label);

async function realtime(pcm: Buffer) {
  console.log("\n── Scribe v3 Live (diarize + turn_prediction) ──");
  const stt = new ElevenLabsSTTAdapter({
    getToken,
    commitStrategy: "turn_prediction",
    diarize: true,
    language: null,
    maxReconnects: 0,
  });

  const t0 = Date.now();
  const at = () => `${((Date.now() - t0) / 1000).toFixed(2)}s`;
  const seen = new Map<string, number>();
  const found = {
    turnProbability: false,
    partialWords: false,
    finals: 0,
    drafts: 0,
    settled: 0,
    settleMs: [] as number[],
    errors: [] as string[],
    unknown: new Set<string>(),
  };
  const tracker = new SpeakerTracker();

  // Look at every raw message before the adapter does.
  const handle = stt.handleMessage.bind(stt);
  stt.handleMessage = (m) => {
    seen.set(m.message_type, (seen.get(m.message_type) ?? 0) + 1);
    if (!KNOWN.has(m.message_type)) found.unknown.add(m.message_type);
    if (m.message_type === "partial_transcript") {
      if (typeof m.turn_probability === "number") found.turnProbability = true;
      if (Array.isArray(m.words) && !found.partialWords) {
        found.partialWords = true;
        console.log(at(), "partial carries words:", JSON.stringify(m.words.slice(0, 2)));
      }
    } else if (m.message_type !== "session_started") {
      const copy: Record<string, unknown> = { ...m };
      if (Array.isArray(copy.words)) copy.words = `[${copy.words.length} words]`;
      console.log(at(), "raw:", JSON.stringify(copy));
    }
    handle(m);
  };

  stt.on("final", (text) => {
    found.finals += 1;
    const committedAt = Date.now();
    const pending = stt.speakers.forFinal();
    if (pending.draft) found.drafts += 1;
    console.log(at(), `final: "${text}"`);
    console.log(at(), "  draft labels:", JSON.stringify(pending.draft?.map((t) => [t.speakerId, t.text]) ?? null));
    void pending.settled.then((turns) => {
      if (!turns) return;
      found.settled += 1;
      found.settleMs.push(Date.now() - committedAt);
      tracker.record(turns);
      console.log(at(), `  settled labels after ${Date.now() - committedAt}ms:`);
      for (const line of tracker.format(turns).split("\n")) console.log("     ", line);
    });
  });
  stt.on("error", (e) => found.errors.push(e.message));
  stt.scribe.on("speakers_merged", ({ from, to }) => tracker.merge(from, to));
  stt.scribe.on("warning", (w) => console.log(at(), "warning:", w));
  let lastShown = -1;
  stt.scribe.on("turn_probability", (p) => {
    if (Math.abs(p - lastShown) >= 0.2) {
      lastShown = p;
      console.log(at(), `  turn_probability ${p.toFixed(2)}`);
    }
  });

  try {
    await stt.connect();
  } catch (e) {
    console.log("Could not open the realtime WebSocket:", (e as Error).message);
    console.log("Check that this network allows WebSockets to api.elevenlabs.io.");
    return null;
  }

  await stream(stt, pcm);
  stt.disconnect();

  console.log("\nmessage types:", JSON.stringify([...seen]));
  const ms = found.settleMs;
  console.log("\nRealtime checklist:");
  check(found.finals > 0, `turn prediction committed on its own (${found.finals} finals)`);
  check(found.turnProbability, "partials carry turn_probability");
  check(found.settled > 0, `settled speaker labels arrived (${found.settled}/${found.finals})`);
  check(tracker.count >= 2, `more than one speaker told apart (${tracker.count})`);
  check(found.partialWords, "partials carry draft words (used when settled labels are late)");
  if (ms.length) {
    console.log(`  settled labels took ${Math.min(...ms)}–${Math.max(...ms)}ms after the commit ` +
      `(GloveVoice waits speakers.waitMs = 350 by default)`);
  }
  check(found.unknown.size === 0, `no unknown message types${found.unknown.size ? `: ${[...found.unknown].join(", ")}` : ""}`);
  check(found.errors.length === 0, `no errors${found.errors.length ? `: ${found.errors.join(" | ")}` : ""}`);
  return tracker;
}

// ─── Realtime with timestamps: are commits sent in pairs? ──────────────────

// With `includeTimestamps`, the adapter expects every commit as two events:
// a plain `committed_transcript` and a `committed_transcript_with_timestamps`
// with the same text, and emits `final` once for the two. This pass lists
// the commit events in arrival order so that can be read off per utterance.
async function pairing(pcm: Buffer) {
  console.log("\n── Scribe v3 Live (include_timestamps): commit pairing ──");
  const stt = new ElevenLabsSTTAdapter({
    getToken,
    commitStrategy: "turn_prediction",
    includeTimestamps: true,
    language: null,
    maxReconnects: 0,
  });

  const t0 = Date.now();
  const at = () => `${((Date.now() - t0) / 1000).toFixed(2)}s`;
  const commits: { kind: "plain" | "timed"; text: string }[] = [];
  const finals: string[] = [];

  const handle = stt.handleMessage.bind(stt);
  stt.handleMessage = (m) => {
    const kind =
      m.message_type === "committed_transcript"
        ? "plain"
        : m.message_type === "committed_transcript_with_timestamps"
          ? "timed"
          : null;
    if (kind) {
      const text = typeof m.text === "string" ? m.text.trim() : "";
      commits.push({ kind, text });
      console.log(at(), `${kind.padEnd(5)} "${text}"`);
    }
    handle(m);
  };
  stt.on("final", (text) => {
    finals.push(text.trim());
    console.log(at(), `  -> final "${text.trim()}"`);
  });
  stt.on("error", (e) => console.log(at(), "error:", e.message));

  try {
    await stt.connect();
  } catch (e) {
    console.log("Could not open the realtime WebSocket:", (e as Error).message);
    return;
  }
  await stream(stt, pcm);
  stt.disconnect();

  const plain = commits.filter((c) => c.kind === "plain").map((c) => c.text);
  const timed = commits.filter((c) => c.kind === "timed").map((c) => c.text);
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((t, i) => t === b[i]);
  console.log("\narrival order:", commits.map((c) => c.kind).join(" ") || "(no commits)");
  console.log("\nPairing checklist:");
  check(plain.length > 0, `commits arrived (${plain.length} plain, ${timed.length} timed)`);
  check(
    same(plain, timed),
    "every utterance has one plain and one timed commit with the same text, in the same order",
  );
  check(
    finals.length === plain.length,
    `the adapter emitted one final per utterance (${finals.length} finals, ${plain.length} utterances)`,
  );
  if (!same(plain, timed)) {
    console.log("  plain:", JSON.stringify(plain));
    console.log("  timed:", JSON.stringify(timed));
  }
}

// ─── Batch: Scribe v3 ──────────────────────────────────────────────────────

async function batch(pcm: Buffer) {
  console.log("\n── Scribe v3 (batch, diarize) ──");
  const t0 = Date.now();
  const result = await transcribeWithElevenLabs({
    apiKey: apiKey!,
    audio: toWav(pcm),
    filename: "clip.wav",
    mimeType: "audio/wav",
    diarize: true,
  });
  console.log(`took ${Date.now() - t0}ms, language ${result.languageCode}, ${result.words.length} words`);
  const tracker = new SpeakerTracker();
  tracker.record(result.turns);
  console.log(tracker.format(result.turns));
  console.log(
    "speakers:",
    tracker.list().map((s) => `${s.label} ${Math.round(s.share * 100)}%`).join(", "),
  );
}

const clip = await loadClip();
const live = await realtime(clip);
if (live) await pairing(clip);
await batch(clip);
process.exit(0);
