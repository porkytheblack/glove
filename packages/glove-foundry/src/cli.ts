#!/usr/bin/env node

import { watch, type FSWatcher } from "node:fs";
import { access } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";
import {
  EMPTY_FOUNDRY_APPLICATION,
  isFoundryApplication,
  type FoundryApplication,
} from "./application.js";
import {
  DEFAULT_FOUNDRY_CONFIG,
  type FoundryConfig,
} from "./config.js";
import { writeGeneratedTypes } from "./codegen.js";
import { loadEnvFile } from "./env.js";
import { FoundryRuntime } from "./runtime.js";
import {
  FOUNDRY_TEMPLATES,
  displayPath,
  scaffoldFoundryProject,
  type FoundryPackageManager,
  type FoundryScaffoldTarget,
  type FoundryTemplateName,
} from "./scaffold.js";
import { FoundryServer } from "./server.js";

interface ParsedArgs {
  command?: string;
  positional: string[];
  flags: Record<string, string | boolean>;
  gloveSyntax: boolean;
}

const HELP = `Glove Foundry — a file-routed runtime for agents

Usage:
  glove foundry init [directory]  Create a Foundry application
  glove foundry dev [options]     Run the development runtime and inspector
  glove foundry start [options]   Run without file watching

  The bare form still works: glove foundry my-app

Create options:
  --template <name>               travel-concierge (default) or minimal
                                    travel-concierge  a worked example: flights, a
                                                      calendar app, chat transport,
                                                      memory, a schedule, a REPL
                                    minimal           one agent and one tool
  --target <name>                 standalone (default) or nextjs
                                    Detected automatically: a directory holding a
                                    Next.js app gets the nextjs target, which adds
                                    agents under foundry/ and leaves the app alone.
  --package-manager <name>        pnpm, npm, yarn, or bun (detected by lockfile)

Run options:
  --root <directory>              Project root (default: current directory)
  --port <number>                 Override the configured port
  --host <address>                Override the configured host
  --no-watch                      Disable agent/config hot restart

Examples:
  glove foundry init my-agents
  glove foundry init my-agents --template minimal
  glove foundry init . --target nextjs     Add agents to the app in this directory
`;

function parseArgs(raw: string[]): ParsedArgs {
  const args = [...raw];
  const gloveSyntax = args[0] === "foundry";
  if (gloveSyntax) args.shift();
  const command = args[0];
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let index = 1; index < args.length; index++) {
    const value = args[index]!;
    if (value.startsWith("--")) {
      const name = value.slice(2);
      const next = args[index + 1];
      if (next && !next.startsWith("--")) {
        flags[name] = next;
        index++;
      } else {
        flags[name] = true;
      }
    } else {
      positional.push(value);
    }
  }
  return { command, positional, flags, gloveSyntax };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function loadConfig(rootDir: string): Promise<FoundryConfig> {
  const candidates = ["foundry.config.ts", "foundry.config.mts", "foundry.config.js", "foundry.config.mjs"];
  for (const candidate of candidates) {
    const path = resolve(rootDir, candidate);
    if (!(await pathExists(path))) continue;
    const url = pathToFileURL(path);
    url.searchParams.set("t", String(Date.now()));
    const imported = (await import(url.href)) as { default?: FoundryConfig };
    if (!imported.default) {
      throw new Error(`${candidate} must have a default export.`);
    }
    return imported.default;
  }
  return {};
}

async function loadApplication(
  rootDir: string,
  config: FoundryConfig,
): Promise<FoundryApplication> {
  const relativePath =
    config.applicationFile ?? DEFAULT_FOUNDRY_CONFIG.applicationFile;
  const path = resolve(rootDir, relativePath);
  if (!(await pathExists(path))) return EMPTY_FOUNDRY_APPLICATION;
  const url = pathToFileURL(path);
  url.searchParams.set("t", String(Date.now()));
  const imported = (await import(url.href)) as { default?: unknown };
  if (!isFoundryApplication(imported.default)) {
    throw new Error(`${relativePath} must default-export defineApplication(...).`);
  }
  return imported.default;
}

async function runWorker(parsed: ParsedArgs): Promise<void> {
  const rootDir = resolve(
    typeof parsed.flags.root === "string" ? parsed.flags.root : process.cwd(),
  );
  await loadEnvFile(resolve(rootDir, ".env"));
  await loadEnvFile(resolve(rootDir, ".env.local"));
  const config = await loadConfig(rootDir);
  const application = await loadApplication(rootDir, config);
  const applicationFilePath = resolve(
    rootDir,
    config.applicationFile ?? DEFAULT_FOUNDRY_CONFIG.applicationFile,
  );
  const agentsDir = resolve(
    rootDir,
    config.agentsDir ?? DEFAULT_FOUNDRY_CONFIG.agentsDir,
  );
  const runtime = await FoundryRuntime.discover({
    rootDir,
    agentsDir,
    application,
    ...(await pathExists(applicationFilePath) ? { applicationFilePath } : {}),
    config,
  });
  await writeGeneratedTypes({
    rootDir,
    agents: runtime.agents,
    manifest: runtime.manifest,
  });
  await runtime.start();
  const server = new FoundryServer(runtime, {
    host:
      typeof parsed.flags.host === "string"
        ? parsed.flags.host
        : config.server?.host ?? DEFAULT_FOUNDRY_CONFIG.server.host,
    port:
      typeof parsed.flags.port === "string"
        ? Number(parsed.flags.port)
        : config.server?.port ?? DEFAULT_FOUNDRY_CONFIG.server.port,
  });
  const listening = await server.listen();
  await runtime.health();
  process.stdout.write(`\n  Glove Foundry\n\n`);
  process.stdout.write(`  Local:    ${listening.url}\n`);
  process.stdout.write(`  Agents:   ${runtime.agents.length}\n`);
  process.stdout.write(`  Runtime:  ready\n`);
  process.stdout.write(`  Types:    .foundry/routes.d.ts\n\n`);

  let closing = false;
  const close = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    await server.close();
    await runtime.stop();
  };
  process.once("SIGTERM", () => void close());
  process.once("SIGINT", () => void close());
}

function shouldRestart(
  rootDir: string,
  changed: string | null,
  agentsDir: string,
): boolean {
  if (!changed) return false;
  const normalized = relative(rootDir, resolve(rootDir, changed)).split(sep).join("/");
  return (
    normalized.startsWith(`${agentsDir}/`) ||
    normalized === ".env" ||
    normalized === ".env.local" ||
    /^(?:[\w.-]+\/)*foundry\.application\.(?:ts|mts|js|mjs)$/.test(normalized) ||
    /^foundry\.config\.(?:ts|mts|js|mjs)$/.test(normalized)
  );
}

async function superviseDev(parsed: ParsedArgs): Promise<void> {
  const rootDir = resolve(
    typeof parsed.flags.root === "string" ? parsed.flags.root : process.cwd(),
  );
  // Hot restart has to follow the configured layout, not assume agents/ at the
  // root -- a Next.js project keeps them under foundry/agents.
  const agentsDir = (await loadConfig(rootDir)).agentsDir
    ?? DEFAULT_FOUNDRY_CONFIG.agentsDir;
  const cliPath = fileURLToPath(import.meta.url);
  const tsxImport = import.meta.resolve("tsx");
  let child: ChildProcess | null = null;
  const watchers: FSWatcher[] = [];
  let restarting = false;
  let stopping = false;
  let debounce: ReturnType<typeof setTimeout> | null = null;

  const workerArgs = [
    "--import",
    tsxImport,
    cliPath,
    "__dev-worker",
    "--root",
    rootDir,
    ...(typeof parsed.flags.port === "string" ? ["--port", parsed.flags.port] : []),
    ...(typeof parsed.flags.host === "string" ? ["--host", parsed.flags.host] : []),
  ];
  const start = (): void => {
    child = spawn(process.execPath, workerArgs, {
      cwd: rootDir,
      env: process.env,
      stdio: "inherit",
    });
    child.once("exit", (code) => {
      child = null;
      if (!stopping && !restarting && code !== 0) {
        process.stderr.write(`Foundry worker exited with code ${code ?? "unknown"}.\n`);
      }
    });
  };
  const restart = (): void => {
    if (stopping || restarting) return;
    restarting = true;
    process.stdout.write("\n  Change detected — restarting Foundry…\n");
    const old = child;
    if (!old) {
      restarting = false;
      start();
      return;
    }
    old.once("exit", () => {
      restarting = false;
      if (!stopping) start();
    });
    old.kill("SIGTERM");
  };

  start();
  if (!parsed.flags["no-watch"]) {
    try {
      const onChange = (filename: string | null): void => {
        if (!shouldRestart(rootDir, filename?.toString() ?? null, agentsDir)) return;
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(restart, 120);
      };
      watchers.push(
        watch(rootDir, { recursive: false }, (_event, filename) =>
          onChange(filename?.toString() ?? null),
        ),
      );
      const watchedAgentsDir = resolve(rootDir, agentsDir);
      if (await pathExists(watchedAgentsDir)) {
        watchers.push(
          watch(watchedAgentsDir, { recursive: true }, (_event, filename) =>
            onChange(
              filename ? `${agentsDir}/${filename.toString()}` : agentsDir,
            ),
          ),
        );
      }
      for (const directory of [
        "tools",
        "applications",
        "mcp",
        "memory",
        "inboxes",
      ]) {
        const watched = resolve(rootDir, directory);
        if (await pathExists(watched)) {
          watchers.push(
            watch(watched, { recursive: true }, (_event, filename) =>
              onChange(
                filename ? `${directory}/${filename.toString()}` : directory,
              ),
            ),
          );
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Foundry file watching is unavailable: ${message}\n`);
    }
  }
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    for (const watcher of watchers) watcher.close();
    if (debounce) clearTimeout(debounce);
    child?.kill("SIGTERM");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

async function superviseStart(parsed: ParsedArgs): Promise<void> {
  const rootDir = resolve(
    typeof parsed.flags.root === "string" ? parsed.flags.root : process.cwd(),
  );
  const child = spawn(
    process.execPath,
    [
      "--import",
      import.meta.resolve("tsx"),
      fileURLToPath(import.meta.url),
      "__start-worker",
      "--root",
      rootDir,
      ...(typeof parsed.flags.port === "string"
        ? ["--port", parsed.flags.port]
        : []),
      ...(typeof parsed.flags.host === "string"
        ? ["--host", parsed.flags.host]
        : []),
    ],
    {
      cwd: rootDir,
      env: process.env,
      stdio: "inherit",
    },
  );
  const forwardSignal = (signal: NodeJS.Signals): void => {
    if (!child.killed) child.kill(signal);
  };
  const interrupt = (): void => forwardSignal("SIGINT");
  const terminate = (): void => forwardSignal("SIGTERM");
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", terminate);
  const exitCode = await new Promise<number | null>((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", resolveExit);
  });
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", terminate);
  if (exitCode !== 0 && exitCode !== null) {
    throw new Error(`Foundry worker exited with code ${exitCode}.`);
  }
}

/** A mistake in how the command was typed, reported without a stack trace. */
class UsageError extends Error {}

function flagValue<T extends string>(
  parsed: ParsedArgs,
  name: string,
  allowed: ReadonlyArray<T>,
): T | undefined {
  const raw = parsed.flags[name];
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || !allowed.includes(raw as T)) {
    throw new UsageError(
      `--${name} must be one of: ${allowed.join(", ")}.` +
        (typeof raw === "string" ? ` Received "${raw}".` : ""),
    );
  }
  return raw as T;
}

async function create(directory: string, parsed: ParsedArgs): Promise<void> {
  const template = flagValue<FoundryTemplateName>(parsed, "template", FOUNDRY_TEMPLATES);
  const target = flagValue<FoundryScaffoldTarget>(parsed, "target", ["standalone", "nextjs"]);
  const packageManager = flagValue<FoundryPackageManager>(
    parsed,
    "package-manager",
    ["pnpm", "npm", "yarn", "bun"],
  );
  const result = await scaffoldFoundryProject({
    directory,
    ...(template ? { template } : {}),
    ...(target ? { target } : {}),
    ...(packageManager ? { packageManager } : {}),
  });

  const where = displayPath(result.rootDir);
  const pm = result.packageManager;
  const run = (script: string): string =>
    pm === "npm" ? `npm run ${script}` : `${pm} ${script}`;
  const install = pm === "yarn" ? "yarn" : `${pm} install`;

  const lines: string[] = [""];
  if (result.target === "nextjs") {
    lines.push(`  Added Glove Foundry to the app in ${result.rootDir}`);
    lines.push("");
    lines.push(`  Agents:   ${result.agentsDir}/${result.agentRoute}/agent.ts`);
    lines.push(`  Client:   lib/foundry.ts`);
    lines.push(`  Route:    app/api/${result.agentRoute}/route.ts`);
    lines.push(`  Guide:    foundry/README.md`);
    lines.push("");
    lines.push("  Next:");
    if (where !== ".") lines.push(`    cd ${where}`);
    lines.push(`    ${install}`);
    lines.push(`    ${run("foundry:dev")}      # runtime + inspector on :4141`);
    lines.push(`    ${run("dev")}              # your Next.js app`);
  } else {
    lines.push(`  Created a Glove Foundry app in ${result.rootDir}`);
    lines.push("");
    lines.push(`  Template: ${result.template}`);
    lines.push(`  Agent:    ${result.agentsDir}/${result.agentRoute}/agent.ts`);
    lines.push(`  Guide:    README.md`);
    lines.push("");
    lines.push("  Next:");
    if (where !== ".") lines.push(`    cd ${where}`);
    lines.push("    cp .env.example .env.local");
    lines.push(`    ${install}`);
    lines.push(`    ${run("dev")}`);
    lines.push("");
    lines.push("  Then open http://127.0.0.1:4141 and press Start a run.");
    if (result.template === "travel-concierge") {
      lines.push("  It works without an API key — a demo model answers until you set one.");
    }
  }
  if (!result.versions.resolved) {
    lines.push("");
    lines.push("  Note: some Glove versions came from built-in defaults rather than");
    lines.push("  this install's own manifest. Check before installing:");
    lines.push(`    ${result.versions.fellBack.join(", ")}`);
  }
  lines.push("");
  process.stdout.write(lines.join("\n"));
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (
    parsed.command === "__dev-worker" ||
    parsed.command === "__start-worker"
  ) {
    await runWorker(parsed);
    return;
  }
  if (["help", "--help", "-h"].includes(parsed.command ?? "")) {
    process.stdout.write(HELP);
    return;
  }
  const createByGloveSyntax = parsed.gloveSyntax &&
    parsed.command !== "dev" &&
    parsed.command !== "start";
  if (parsed.command === "init" || createByGloveSyntax || (parsed.gloveSyntax && !parsed.command)) {
    const directory =
      parsed.command === "init"
        ? parsed.positional[0] ?? "glove-foundry-app"
        : parsed.command ?? "glove-foundry-app";
    await create(directory, parsed);
    return;
  }
  if (parsed.command === "dev") {
    await superviseDev(parsed);
    return;
  }
  if (parsed.command === "start") {
    await superviseStart(parsed);
    return;
  }
  process.stdout.write(HELP);
}

main().catch((error: unknown) => {
  if (error instanceof UsageError) {
    process.stderr.write(`\n  ${error.message}\n\n  Run "glove foundry help" for usage.\n\n`);
  } else {
    process.stderr.write(
      `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
    );
  }
  process.exitCode = 1;
});
