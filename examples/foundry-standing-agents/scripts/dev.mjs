import { spawn } from "node:child_process";

// Local development: Foundry's dev runtime and inspector (port 4145, from
// foundry.config.ts) and `next dev` on $PORT (3000), together.

const env = { ...process.env, FOUNDRY_URL: process.env.FOUNDRY_URL ?? "http://127.0.0.1:4145", PORT: process.env.PORT ?? "3000" };

// Each in its own process group, so stopping one stops what it started too.
const run = (script) => spawn("pnpm", ["run", script], { stdio: "inherit", env, detached: true });
const children = [run("dev:foundry"), run("dev:web")];

let closing = false;
function close(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
  setTimeout(() => process.exit(code), 500).unref();
}

for (const child of children) child.once("exit", (code) => close(code ?? 0));
process.once("SIGINT", () => close());
process.once("SIGTERM", () => close());
