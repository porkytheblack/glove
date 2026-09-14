import { spawn } from "node:child_process";

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
