// Regression check for the prewarmed TTS socket.
//
// The bug this exists for: the room opens a TTS socket when the VAD first
// hears you, to overlap the handshake with model time. ElevenLabs closes an
// input stream that receives nothing for ~20s, and a dead socket left in the
// prewarm slot was adopted by the next turn — so text streamed into a closed
// connection and the caller heard nothing at all.
//
// `smoke.mjs` cannot catch it: typed input never trips the VAD, so it never
// prewarms. This one sends real audio frames to trigger a prewarm, waits out
// the idle timeout, and then asks for a spoken turn.
//
//   PORT=4501 node scripts/prewarm-check.mjs

import WebSocket from "ws";

const PORT = process.env.PORT ?? 4501;
const IDLE_WAIT_MS = Number(process.env.IDLE_WAIT_MS ?? 26_000);

const ws = new WebSocket(`ws://localhost:${PORT}`);
ws.binaryType = "arraybuffer";

let audioBytes = 0;
let spoken = "";
const t0 = Date.now();
const at = () => `${String(Date.now() - t0).padStart(6)}ms`;

/** 20ms of noisy tone at 16kHz — enough energy to trip the VAD. */
function speechFrame(i) {
  const pcm = new Int16Array(320);
  for (let n = 0; n < pcm.length; n++) {
    const t = (i * 320 + n) / 16000;
    pcm[n] = Math.round((Math.sin(2 * Math.PI * 180 * t) * 0.35 + (Math.random() - 0.5) * 0.15) * 32767);
  }
  return Buffer.from(pcm.buffer);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

ws.on("message", (data, isBinary) => {
  if (isBinary) {
    audioBytes += data.byteLength ?? data.length;
    return;
  }
  const msg = JSON.parse(data.toString());
  if (msg.t === "speech") spoken += msg.text;
  if (msg.t === "error") console.log(`${at()} ERROR ${msg.message}`);
  if (msg.t === "metric" && msg.name === "tts_prewarm_discarded") {
    console.log(`${at()} prewarm socket was discarded as dead (the guard worked)`);
  }
  if (msg.t === "metric" && msg.name === "tts_first_audio_ms") {
    console.log(`${at()} first audio ${msg.ms}ms (prewarmed: ${msg.data?.prewarmed})`);
  }
});

ws.on("open", async () => {
  console.log(`${at()} connected`);

  // ~1.2s of "speech" — trips the VAD, which triggers the prewarm.
  console.log(`${at()} sending audio to trigger a prewarm…`);
  for (let i = 0; i < 60; i++) {
    ws.send(speechFrame(i));
    await sleep(20);
  }

  // Sit quiet past the provider's input timeout. The prewarmed socket dies
  // here; the keepalive is what should stop that mattering.
  console.log(`${at()} idling ${IDLE_WAIT_MS / 1000}s to outlast the TTS input timeout…`);
  await sleep(IDLE_WAIT_MS);

  console.log(`${at()} asking for a spoken reply`);
  ws.send(JSON.stringify({ t: "say", speaker: "operator", text: "Nova, are you there?" }));

  await sleep(20_000);
  console.log("\n─── result ───────────────────────────────");
  console.log(`spoken : ${spoken.trim() || "(nothing)"}`);
  console.log(`audio  : ${audioBytes} bytes`);
  const ok = audioBytes > 0;
  console.log(`\n${ok ? "PASS — audio played after the idle gap" : "FAIL — silent, the prewarm path is still broken"}`);
  ws.close();
  process.exit(ok ? 0 : 1);
});

ws.on("error", (err) => {
  console.error("socket error:", err.message);
  process.exit(1);
});
