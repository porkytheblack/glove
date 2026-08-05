// End-to-end smoke test for the gateway, without a microphone.
//
// Connects like the browser does, types a line as the operator (the same path a
// spoken utterance takes once it has been committed), and reports what came
// back: Nova's spoken text, the delegation's lifecycle through the station
// queue, and how many bytes of synthesized audio actually arrived.
//
//   node scripts/smoke.mjs ["a line to say"]

import WebSocket from "ws";

const LINE = process.argv[2] ?? "Nova, is hull KES-0007 still under warranty?";
const PORT = process.env.PORT ?? 4500;
const DEADLINE_MS = 90_000;

const ws = new WebSocket(`ws://localhost:${PORT}`);
ws.binaryType = "arraybuffer";

let audioBytes = 0;
let spoken = "";
const events = [];
const t0 = Date.now();
const at = () => `${String(Date.now() - t0).padStart(6)}ms`;

const done = (code) => {
  console.log("\n─── summary ───────────────────────────────────────────");
  console.log(`spoken by Nova : ${spoken.trim() || "(nothing)"}`);
  console.log(`audio received : ${audioBytes} bytes (${(audioBytes / 32000).toFixed(2)}s at 16kHz)`);
  console.log(`events         : ${events.join(", ")}`);
  const ok = spoken.trim().length > 0 && audioBytes > 0;
  console.log(`\n${ok ? "PASS" : "FAIL"} — speech ${spoken ? "yes" : "no"}, audio ${audioBytes ? "yes" : "no"}`);
  ws.close();
  process.exit(code ?? (ok ? 0 : 1));
};

const timer = setTimeout(() => done(1), DEADLINE_MS);

ws.on("open", () => console.log(`${at()} connected`));

ws.on("message", (data, isBinary) => {
  if (isBinary) {
    audioBytes += data.byteLength ?? data.length;
    return;
  }
  const msg = JSON.parse(data.toString());
  switch (msg.t) {
    case "ready":
      console.log(`${at()} ready — ${JSON.stringify(msg.config)}`);
      events.push("ready");
      console.log(`${at()} saying: "${LINE}"`);
      ws.send(JSON.stringify({ t: "say", speaker: "operator", text: LINE }));
      break;
    case "speech":
      spoken += msg.text;
      process.stdout.write(msg.text);
      break;
    case "speech_end":
      console.log(`\n${at()} turn ${msg.turnId} finished generating`);
      events.push(`speech_end:${msg.turnId}`);
      // Acknowledge playback so the gateway reopens the microphone path, just
      // as the browser's playback worklet would.
      ws.send(JSON.stringify({ t: "playback_done", turnId: msg.turnId }));
      break;
    case "delegation":
      console.log(`${at()} delegation ${msg.phase}${msg.detail ? ` — ${msg.detail}` : ""}`);
      events.push(`delegation:${msg.phase}`);
      // The findings come back as another turn; give it room, then finish.
      if (msg.phase === "done" || msg.phase === "failed") {
        clearTimeout(timer);
        setTimeout(() => done(), 20_000);
      }
      break;
    case "metric":
      if (["front_ttft_ms", "tts_first_audio_ms", "delegation_roundtrip_ms"].includes(msg.name)) {
        console.log(`${at()} ${msg.name} = ${msg.ms}ms`);
      }
      break;
    case "error":
      console.error(`${at()} ERROR ${msg.message}`);
      events.push("error");
      break;
  }
});

ws.on("error", (err) => {
  console.error("socket error:", err.message);
  process.exit(1);
});
