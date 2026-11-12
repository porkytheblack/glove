import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";

// Runs Foundry (the agent runtime and its inspector) and the web app together.
// Both read the same .env.

for (const name of [".env", ".env.local"]) {
  const file = resolve(process.cwd(), name);
  if (existsSync(file)) loadEnvFile(file);
}

const children = [
  spawn("pnpm", ["run", "dev:foundry"], { stdio: "inherit", env: process.env }),
  spawn("pnpm", ["run", "dev:web"], { stdio: "inherit", env: process.env }),
];
let closing = false;
function close(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 200).unref();
}
for (const child of children) child.once("exit", (code) => close(code ?? 0));
process.once("SIGINT", () => close());
process.once("SIGTERM", () => close());
