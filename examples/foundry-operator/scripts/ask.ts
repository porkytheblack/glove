import { port } from "../lib/settings.js";
const message = process.argv.slice(2).join(" ");
if (!message) throw new Error('Usage: pnpm ask "Give the agent a direction"');
const base = `http://127.0.0.1:${port}`;
const response = await fetch(`${base}/api/message`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ message }) });
if (!response.ok) throw new Error(`Direction was not accepted (${response.status}); inspect the console.`);
const { id } = await response.json() as { id: string };
console.log(`Run ${id} started. Watch ${base}`);
const deadline = Date.now() + 300000;
let finished = false;
while (Date.now() < deadline) {
  const state = await (await fetch(`${base}/api/state`)).json();
  if (state.run?.id === id && !["pending", "running", "retrying"].includes(state.run.status)) {
    console.log(`Status: ${state.run.status}`);
    if (state.run.status !== "completed") process.exitCode = 1;
    else console.log(typeof state.run.output?.value === "string" ? state.run.output.value : JSON.stringify(state.run.output));
    finished = true;
    break;
  }
  await new Promise(resolve => setTimeout(resolve, 1500));
}
if (!finished) {
  console.error(`The run is still pending after five minutes. Check ${base} before retrying; it has not been cancelled.`);
  process.exitCode = 1;
}
