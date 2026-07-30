// Does Scribe actually accept our keyterm list, and does biasing change what
// it hears?
//
//   pnpm tsx scripts/keyterms-check.ts
//
// A rejected `keyterms` param would fail SILENTLY as far as the room is
// concerned — the socket still opens and transcription still works, just
// without the bias that is the whole point. So connect both ways and prove the
// biased session is accepted and returns text.

import "./../lib/load-env";
import { ElevenLabsSTTAdapter } from "glove-voice";
import { createElevenLabsSTTToken } from "glove-voice/server";
import { roomKeyterms } from "../lib/keyterms";

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) throw new Error("ELEVENLABS_API_KEY not set");

const VOICE = "JBFqnCBsd6RMkjVDRZzb";
const LINE = "I'm interested in the Kestrel L2 hauler from Meridian Yards.";

async function say(text: string): Promise<Int16Array> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=pcm_16000`,
    {
      method: "POST",
      headers: { "xi-api-key": KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: "eleven_flash_v2_5" }),
    },
  );
  if (!res.ok) throw new Error(`TTS ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function transcribe(pcm: Int16Array, keyterms: string[]): Promise<string> {
  const stt = new ElevenLabsSTTAdapter({
    getToken: () => createElevenLabsSTTToken(KEY!),
    keyterms,
  });
  let failed = "";
  stt.on("error", (e: Error) => { failed = e.message; });
  let final = "";
  stt.on("final", (t: string) => { final ||= t; });
  await stt.connect();
  for (let i = 0; i + 320 <= pcm.length; i += 320) {
    stt.sendAudio(pcm.subarray(i, i + 320));
    await sleep(20);
  }
  stt.flushUtterance();
  for (let i = 0; i < 40 && !final; i++) await sleep(250);
  const partial = stt.currentPartial;
  stt.disconnect();
  if (failed) throw new Error(failed);
  return (final || partial).trim();
}

const terms = roomKeyterms();
console.log(`biasing toward ${terms.length} terms: ${terms.slice(0, 6).join(", ")}…\n`);
const pcm = await say(LINE);
console.log(`spoken: "${LINE}"\n`);

const plain = await transcribe(pcm, []);
console.log(`without keyterms: "${plain}"`);
await sleep(1000);
const biased = await transcribe(pcm, terms);
console.log(`with keyterms   : "${biased}"`);

// The bar is that the biased session is ACCEPTED and transcribes. Whether it
// beats the unbiased one on this clean synthetic clip is not the point — the
// gain is on accented and noisy speech, which this cannot synthesize.
const ok = biased.length > 0;
console.log(`\n${ok ? "PASS — keyterms accepted and transcribing" : "FAIL — biased session produced nothing"}`);
process.exit(ok ? 0 : 1);
