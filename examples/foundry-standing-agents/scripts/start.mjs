import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// One Kuiper unit runs both processes and they share /data: Foundry on
// loopback, with no public address, and the web app on the public port. The
// browser only ever talks to the web app, and Slack reaches Foundry through
// the web app's /webhooks/slack. If either exits, both stop.

const foundryPort = process.env.FOUNDRY_PORT ?? "4141";
const env = { ...process.env, FOUNDRY_URL: process.env.FOUNDRY_URL ?? `http://127.0.0.1:${foundryPort}` };

// The installed binaries, not `pnpm exec`: the runtime image has Node but no pnpm.
// Each in its own process group, so a signal reaches the workers they start too.
const bin = (name) => fileURLToPath(new URL(`../node_modules/.bin/${name}`, import.meta.url));
const run = (name, args) => spawn(bin(name), args, { stdio: "inherit", env, detached: true });
const children = [
  run("glove", ["foundry", "start", "--host", "127.0.0.1", "--port", foundryPort]),
  run("next", ["start", "-H", "0.0.0.0", "-p", process.env.PORT ?? "3000"]),
];

const signal = (child, name) => {
  try {
    process.kill(-child.pid, name);
  } catch {
    // Already gone.
  }
};

let closing = false;
function close(code = 0, name = "SIGTERM") {
  if (closing) return;
  closing = true;
  for (const child of children) signal(child, name);
  const exited = children.map((child) => child.exitCode !== null || child.signalCode !== null ? undefined : new Promise((resolve) => child.once("exit", resolve)));
  Promise.all(exited).then(() => process.exit(code));
  setTimeout(() => {
    for (const child of children) signal(child, "SIGKILL");
    process.exit(code);
  }, 10_000).unref();
}

for (const child of children) child.once("exit", (code) => close(code ?? 1));
process.once("SIGINT", () => close(0, "SIGINT"));
process.once("SIGTERM", () => close(0, "SIGTERM"));
