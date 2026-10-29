const $ = id => document.getElementById(id);
const ws = new WebSocket(`ws://${location.host}/call`);
ws.binaryType = "arraybuffer";
let audio, capture, source, microphone, clock, nextPlay = 0, playing = false, ready = false;
const players = new Set();
const audiblePlayers = new Set();
let quietTimer;
const send = (type, extra = {}) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...extra })); };
const log = text => { $("log").textContent += `\n${text}`; $("log").scrollTop = $("log").scrollHeight; };
const error = e => { $("error").textContent = e.message ?? String(e); };
function playback(value) { if (playing !== value) { playing = value; send("playback", { speaking: value }); } }
function flush() { clearTimeout(quietTimer); for (const player of players) { player.onended = null; player.stop(); } players.clear(); audiblePlayers.clear(); nextPlay = 0; playback(false); }
function setReady(value) {
  ready = value;
  for (const id of ["send", "mic", "offer", "stop"]) $(id).disabled = !value;
  $("talk").disabled = !value || !microphone;
  $("start").disabled = value;
}
function stopAudio() {
  clearInterval(clock); clock = undefined;
  capture?.disconnect(); capture = undefined;
  source?.disconnect(); source = undefined;
  microphone?.getTracks().forEach(track => track.stop()); microphone = undefined;
  flush(); setReady(false);
}
function startSilence() {
  clearInterval(clock);
  clock = setInterval(() => { if (ready && !capture && ws.readyState === WebSocket.OPEN) ws.send(new Int16Array(480)); }, 20);
}
async function audioContext() {
  audio ??= new AudioContext({ sampleRate: 24000 });
  await audio.resume();
  if (audio.sampleRate !== 24000) throw new Error("This browser cannot open a 24kHz audio context.");
}
$("start").onclick = async () => {
  try { $("error").textContent = ""; await audioContext(); $("start").disabled = true; send("start"); }
  catch (e) { error(e); $("start").disabled = false; }
};
$("stop").onclick = () => { stopAudio(); send("stop"); };
$("reset").onclick = () => { stopAudio(); send("reset"); $("transcript").replaceChildren(); $("log").textContent = "Demo reset."; };
$("offer").onclick = () => send("offer");
$("text-form").onsubmit = e => { e.preventDefault(); const text = $("text").value.trim(); if (!text || !ready) return; caption("user", text); send("text", { text }); $("text").value = ""; };
$("mic").onclick = async () => {
  try {
    if (microphone) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    if (!ready) { stream.getTracks().forEach(t => t.stop()); return; }
    microphone = stream;
    await audio.audioWorklet.addModule("/capture.js");
    capture = new AudioWorkletNode(audio, "capture");
    capture.port.onmessage = ({ data }) => { if (ready && ws.readyState === WebSocket.OPEN) ws.send(data); };
    source = audio.createMediaStreamSource(microphone);
    source.connect(capture); capture.connect(audio.destination);
    $("talk").disabled = false; $("mic").disabled = true;
  } catch (e) { error(e); microphone?.getTracks().forEach(t => t.stop()); microphone = undefined; }
};
function speech(value) {
  if (!ready || !capture) return;
  capture.port.postMessage(value); send("speech", { speaking: value });
  $("talk").classList.toggle("talking", value); $("talk").textContent = value ? "Listening…" : "Hold to talk";
}
$("talk").onpointerdown = e => { $("talk").setPointerCapture(e.pointerId); speech(true); };
$("talk").onpointerup = $("talk").onpointercancel = () => speech(false);
$("talk").onkeydown = e => { if (e.code === "Space") { e.preventDefault(); if (!e.repeat) speech(true); } };
$("talk").onkeyup = e => { if (e.code === "Space") { e.preventDefault(); speech(false); } };
window.addEventListener("blur", () => speech(false));
let lastRole, lastCaption;
function caption(role, text) {
  if (lastRole !== role || !lastCaption?.isConnected) {
    const p = document.createElement("p"), label = document.createElement("b"); label.textContent = role;
    lastCaption = document.createElement("span"); p.append(label, lastCaption); $("transcript").append(p); lastRole = role;
  }
  lastCaption.textContent += text; $("transcript").scrollTop = $("transcript").scrollHeight;
}
function renderSnapshot(data) {
  $("goals").replaceChildren();
  for (const goal of data.goals?.goals ?? []) for (const item of goal.items) {
    const row = document.createElement("div"), mark = document.createElement("span"), label = document.createElement("div"), state = document.createElement("small");
    const done = item.state?.disposition === "done"; row.className = `goal ${done ? "done" : ""}`; mark.className = "mark"; mark.textContent = done ? "✓" : "○";
    label.textContent = item.definition.label; state.textContent = item.state?.disposition ?? "pending"; label.append(state); row.append(mark, label); $("goals").append(row);
  }
  $("order").textContent = `Growth: $${data.catalog.growth.price}/month · Next step: ${data.decision ?? "not decided"}`;
  $("history").textContent = data.history.map(h => `${h.kind}\n${h.text}`).join("\n\n");
}
ws.onmessage = ({ data }) => {
  if (data instanceof ArrayBuffer) {
    if (!ready || !audio) return;
    const pcm = new Int16Array(data), buffer = audio.createBuffer(1, pcm.length, 24000);
    const samples = buffer.getChannelData(0); let energy = 0;
    for (let i = 0; i < pcm.length; i++) { samples[i] = pcm[i] / 32768; energy += samples[i] ** 2; }
    const player = audio.createBufferSource(); player.buffer = buffer; player.connect(audio.destination);
    nextPlay = Math.max(audio.currentTime + .03, nextPlay); player.start(nextPlay); nextPlay += buffer.duration;
    players.add(player);
    // GPT-Live streams silence too. Only audible playback should hold events.
    // This demo uses an energy threshold/hangover, not transcript timing.
    if (Math.sqrt(energy / Math.max(1, pcm.length)) > .004) {
      audiblePlayers.add(player); clearTimeout(quietTimer); playback(true);
    }
    player.onended = () => {
      players.delete(player);
      if (audiblePlayers.delete(player) && !audiblePlayers.size) {
        quietTimer = setTimeout(() => { if (!audiblePlayers.size) playback(false); }, 400);
      }
    }; return;
  }
  const msg = JSON.parse(data);
  if (msg.type === "ready") { setReady(true); startSilence(); }
  else if (msg.type === "state") $("state").textContent = msg.data;
  else if (msg.type === "transcript") caption(msg.data.role, msg.data.text);
  else if (msg.type === "snapshot") renderSnapshot(msg.data);
  else if (msg.type === "tool") log(`${msg.data.name} → ${msg.data.phase}`);
  else if (msg.type === "event") log(`Product event → ${msg.data}`);
  else if (msg.type === "usage") $("usage").textContent = `Provider duration: ${msg.data.seconds ?? "—"}s${msg.data.final ? " · finalized" : ""}`;
  else if (msg.type === "flush") flush();
  else if (msg.type === "ended") { stopAudio(); log(msg.data); }
  else if (msg.type === "error") { error(msg.data); if (!ready) $("start").disabled = false; }
};
ws.onopen = () => { $("state").textContent = "Ready to start"; };
ws.onclose = () => { stopAudio(); $("start").disabled = true; $("state").textContent = "Disconnected"; error("Connection closed. Reload to reconnect to the demo server."); };
ws.onerror = () => error("Could not connect. Check the server is running and another tab has not claimed the demo.");
