// The entire client.
//
// Count what is NOT here: no API keys, no token fetches, no VAD, no silence
// timers, no endpointing heuristics, no turn detection, no transcript dedupe,
// no barge-in logic, no model or agent code. Those all live on the server now.
// What remains is a duct — microphone up, speakers down — plus rendering
// whatever the gateway says happened.
//
// The equivalent logic in the browser-hosted example is ~1100 lines of
// commitment engine in a React hook. This is the same product with the
// decisions moved to where they can see everything and be tuned without a
// client deploy.

const $ = (sel) => document.querySelector(sel);

const ui = {
  connect: $("#connect"),
  status: $("#status"),
  log: $("#log"),
  partial: $("#partial"),
  speaker: $("#speaker"),
  say: $("#say"),
  metrics: $("#metrics"),
  config: $("#config"),
  worker: $("#worker"),
};

let ws = null;
let audioCtx = null;
let captureNode = null;
let playbackNode = null;
let micStream = null;
let currentTurn = 0;
let endedTurns = new Set();
let novaLine = null;
const latencies = [];

// ── rendering ────────────────────────────────────────────────────────────────

function line(who, text, cls) {
  const el = document.createElement("div");
  el.className = `line ${cls ?? who}`;
  el.innerHTML = `<span class="who">${who}</span><span class="body"></span>`;
  el.querySelector(".body").textContent = text;
  ui.log.append(el);
  ui.log.scrollTop = ui.log.scrollHeight;
  return el;
}

function setStatus(text, active) {
  ui.status.textContent = text;
  ui.status.dataset.active = String(Boolean(active));
}

function pushMetric(name, ms, data) {
  if (name === "front_ttft_ms" && typeof ms === "number") {
    latencies.push(ms);
    const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
    ui.metrics.querySelector("#ttft").textContent = `${ms}ms`;
    ui.metrics.querySelector("#ttft-avg").textContent = `avg ${avg}ms`;
  }
  const el = document.createElement("div");
  el.className = "metric";
  el.textContent = `${name}${ms != null ? ` ${ms}ms` : ""}${
    data?.reason ? ` · ${data.reason}` : ""
  }`;
  ui.metrics.querySelector("#metric-log").prepend(el);
  while (ui.metrics.querySelector("#metric-log").childElementCount > 60) {
    ui.metrics.querySelector("#metric-log").lastElementChild.remove();
  }
}

// ── audio ────────────────────────────────────────────────────────────────────

async function startAudio() {
  // 16 kHz end to end: the rate the server, Scribe and ElevenLabs all use, so
  // nothing resamples anywhere in the path.
  audioCtx = new AudioContext({ sampleRate: 16_000 });
  await audioCtx.audioWorklet.addModule("/capture-worklet.js");
  await audioCtx.audioWorklet.addModule("/playback-worklet.js");

  micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      // Browser-side echo cancellation still earns its keep: it stops the
      // agent's own voice from re-entering the microphone. Everything else
      // about the conversation is decided server-side.
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const source = audioCtx.createMediaStreamSource(micStream);
  captureNode = new AudioWorkletNode(audioCtx, "capture");
  captureNode.port.onmessage = (e) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(e.data);
  };
  source.connect(captureNode);
  // Keep the capture node in the graph without routing the microphone to the
  // speakers (which would be a feedback loop).
  const mute = audioCtx.createGain();
  mute.gain.value = 0;
  captureNode.connect(mute).connect(audioCtx.destination);

  playbackNode = new AudioWorkletNode(audioCtx, "playback", { outputChannelCount: [1] });
  playbackNode.port.onmessage = (e) => {
    if (e.data !== "drained") return;
    // Only report a turn drained once the server said it finished generating —
    // a mid-turn network underrun must not reopen the microphone early.
    if (endedTurns.has(currentTurn)) {
      endedTurns.delete(currentTurn);
      send({ t: "playback_done", turnId: currentTurn });
    }
  };
  playbackNode.connect(audioCtx.destination);
}

function stopAudio() {
  micStream?.getTracks().forEach((t) => t.stop());
  void audioCtx?.close();
  audioCtx = captureNode = playbackNode = micStream = null;
}

// ── socket ───────────────────────────────────────────────────────────────────

function send(msg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

async function connect() {
  setStatus("connecting…", false);
  await startAudio();

  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`);
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    ui.connect.textContent = "Hang up";
    send({ t: "speaker", speaker: ui.speaker.value });
  };

  ws.onmessage = (e) => {
    if (e.data instanceof ArrayBuffer) {
      playbackNode?.port.postMessage(e.data, [e.data]);
      return;
    }
    const msg = JSON.parse(e.data);
    switch (msg.t) {
      case "ready":
        setStatus("listening", true);
        ui.config.textContent = Object.entries(msg.config)
          .map(([k, v]) => `${k}: ${v}`)
          .join("  ·  ");
        line("system", `session ${msg.sessionId} — just talk`, "system");
        break;
      case "partial":
        ui.partial.textContent = msg.text;
        break;
      case "utterance":
        ui.partial.textContent = "";
        line(msg.speaker, msg.text, "user");
        break;
      case "speech":
        if (msg.turnId !== currentTurn || !novaLine) {
          currentTurn = msg.turnId;
          novaLine = line("Nova", "", "nova");
        }
        novaLine.querySelector(".body").textContent += msg.text;
        ui.log.scrollTop = ui.log.scrollHeight;
        break;
      case "speech_end":
        endedTurns.add(msg.turnId);
        novaLine = null;
        break;
      case "clear":
        // Barge-in: drop every buffered sample right now.
        playbackNode?.port.postMessage("clear");
        endedTurns.clear();
        novaLine = null;
        line("system", "interrupted", "system");
        break;
      case "state":
        setStatus(
          msg.speaking ? "Nova speaking" : msg.thinking ? "thinking" : "listening",
          true,
        );
        break;
      case "delegation":
        if (msg.phase === "queued") {
          ui.worker.dataset.busy = "true";
          line("worker", `researching: ${msg.detail ?? ""}`, "system");
        } else {
          ui.worker.dataset.busy = "false";
          if (msg.phase === "failed") line("worker", `failed: ${msg.detail ?? ""}`, "system");
        }
        break;
      case "metric":
        pushMetric(msg.name, msg.ms, msg.data);
        break;
      case "error":
        line("error", msg.message, "error");
        break;
    }
  };

  ws.onclose = () => {
    setStatus("idle", false);
    ui.connect.textContent = "🎙 Connect";
    stopAudio();
    ws = null;
  };
}

function hangUp() {
  ws?.close();
  stopAudio();
}

// ── wiring ───────────────────────────────────────────────────────────────────

ui.connect.addEventListener("click", () => {
  if (ws) hangUp();
  else void connect().catch((err) => line("error", err.message, "error"));
});

ui.speaker.addEventListener("change", () => send({ t: "speaker", speaker: ui.speaker.value }));

ui.say.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || !ui.say.value.trim()) return;
  send({ t: "say", speaker: ui.speaker.value, text: ui.say.value });
  ui.say.value = "";
});
