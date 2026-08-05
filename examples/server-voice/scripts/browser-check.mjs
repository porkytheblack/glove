// Drive the REAL browser client with a fake microphone.
//
// Every previous test spoke to the room over a raw WebSocket, which skips the
// entire browser half — getUserMedia, the worklets, the local VAD, and the
// order in which they start up. That half is exactly where the "no audio
// reaches the agent" failures lived.
//
//   node scripts/browser-check.mjs
import { chromium } from "playwright";
import { config as loadEnv } from "dotenv";
import { writeFileSync } from "node:fs";
import path from "node:path";

loadEnv({ path: [path.join(import.meta.dirname, "..", ".env.local")], quiet: true });
const KEY = process.env.ELEVENLABS_API_KEY;
const OUT = "/tmp/claude-0/-home-user-glove/e0e0ae7a-f8fd-50c9-a9a2-86a8f33d3476/scratchpad/mic.wav";

/** 16-bit mono WAV so Chromium can use it as a fake capture device. */
function wav(pcm, rate = 16000) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length * 2, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length * 2, 40);
  return Buffer.concat([h, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.length * 2)]);
}

const res = await fetch(
  "https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb?output_format=pcm_16000",
  { method: "POST", headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ text: "Hi there. I've never bought a ship before and I have no idea where to start.", model_id: "eleven_flash_v2_5" }) },
);
if (!res.ok) throw new Error(`TTS ${res.status}`);
const buf = Buffer.from(await res.arrayBuffer());
const speech = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2));
// Lead with room tone so the VAD sees a noise floor, then the sentence, then quiet.
const pad = new Int16Array(16000 * 2);
for (let i = 0; i < pad.length; i++) pad[i] = Math.round((Math.random() * 2 - 1) * 60);
const tail = new Int16Array(16000 * 12);
for (let i = 0; i < tail.length; i++) tail[i] = Math.round((Math.random() * 2 - 1) * 60);
const all = new Int16Array(pad.length + speech.length + tail.length);
all.set(pad); all.set(speech, pad.length); all.set(tail, pad.length + speech.length);
writeFileSync(OUT, wav(all));
console.log(`fake mic: ${(all.length / 16000).toFixed(1)}s\n`);

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-capture",
    `--use-file-for-fake-audio-capture=${OUT}`,
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const page = await browser.newPage();
page.on("console", (m) => {
  const t = m.text();
  if (/\[room\]|VAD|error|Error|failed/i.test(t)) console.log(`  console: ${t.slice(0, 160)}`);
});
page.on("requestfailed", (r) => console.log(`  request FAILED: ${r.url().slice(0, 120)} — ${r.failure()?.errorText}`));
page.on("response", (r) => {
  if (r.status() >= 400) console.log(`  HTTP ${r.status()}: ${r.url().slice(0, 120)}`);
});
page.on("pageerror", (e) => console.log(`  PAGE ERROR: ${e.message.slice(0, 200)}`));
await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
// React must have hydrated or the click hits inert markup and nothing happens.
await page.waitForTimeout(3000);
const btn = page.getByRole("button", { name: /connect/i });
await btn.click();
console.log("clicked connect — waiting for the room…");
// Confirm the handler actually ran; retry once if the page was still inert.
await page.waitForTimeout(2500);
if (/idle/i.test(await page.locator("body").innerText())) {
  console.log("  (still idle — clicking again after hydration)");
  await btn.click();
}

let live = false;
let lastStatus = "";
for (let i = 0; i < 100; i++) {
  const txt = await page.locator("body").innerText();
  const status = (txt.match(/(idle|claiming a room[^\n]*|starting the room[^\n]*|connecting[^\n]*|listening|Nova speaking|thinking)/i) || [])[0] ?? "";
  if (status && status !== lastStatus) { lastStatus = status; console.log(`  status: ${status}`); }
  if (/just talk|listening|Nova speaking|thinking/i.test(txt)) { live = true; console.log("room is live"); break; }
  await page.waitForTimeout(2000);
}
if (!live) console.log("!! the room never came live");
await page.waitForTimeout(45000);
const body = await page.locator("body").innerText();
console.log("\n──── transcript ────");
console.log(body.split("\n").filter((l) => l.trim()).slice(-30).join("\n"));
await browser.close();
