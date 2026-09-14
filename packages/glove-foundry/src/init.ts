import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { detectPackageManager, detectScaffoldTarget, type ScaffoldOptions } from "./scaffold.js";

export class InitCancelled extends Error {}

export interface InitOptions extends Omit<ScaffoldOptions, "directory"> {
  directory?: string;
  install?: boolean;
}

/** No filesystem writes or credential prompts until the user confirms the plan. */
export async function promptInit(options: InitOptions): Promise<ScaffoldOptions & { install: boolean }> {
  const ui = await import("@clack/prompts");
  ui.intro("Glove Foundry · Build an agent application");
  const answer = <T>(value: T | symbol): T => {
    if (ui.isCancel(value)) {
      ui.cancel("Setup cancelled. No project files were created.");
      throw new InitCancelled();
    }
    return value as T;
  };
  const directory = options.directory ?? answer(await ui.text({
    message: "Where should the project live?",
    placeholder: "my-agent-app",
    defaultValue: "my-agent-app",
    validate: value => !value?.trim() ? "Enter a directory, or . for this directory." : undefined,
  }));
  const detected = await detectScaffoldTarget(resolve(directory));
  const target = options.target ?? answer(await ui.select({
    message: "How will you use Foundry?",
    initialValue: detected,
    options: [
      { value: "standalone" as const, label: "Standalone agent application", hint: "runtime + inspector; connect any frontend" },
      { value: "nextjs" as const, label: "Add to a Next.js app", hint: "colocated agents; preserve existing app files" },
    ],
  }));
  const template = options.template ?? answer(await ui.select({
    message: "Choose your starting point",
    initialValue: "travel-concierge" as const,
    options: [
      { value: "travel-concierge" as const, label: "Guided example", hint: "recommended · keyless demo, tools, apps, memory, schedules, VFS + REPL" },
      { value: "minimal" as const, label: "Minimal agent", hint: "one agent and one tool; bring an OpenRouter key" },
    ],
  }));
  const packageManager = options.packageManager ?? answer(await ui.select({
    message: "Which package manager do you use?",
    initialValue: await detectPackageManager(resolve(directory)),
    options: ["pnpm", "npm", "yarn", "bun"].map(value => ({
      value: value as "pnpm" | "npm" | "yarn" | "bun", label: value,
    })),
  }));
  const install = options.install ?? answer(await ui.confirm({
    message: "Install dependencies after creating the project?",
    initialValue: true,
  }));
  ui.note([
    `Directory: ${resolve(directory)}`,
    `Project: ${target === "nextjs" ? "Existing Next.js app" : "Standalone"}`,
    `Starter: ${template === "minimal" ? "Minimal agent" : "Guided travel concierge"}`,
    `Packages: ${packageManager}${install ? " · install now" : " · install later"}`,
    "Templates use disposable demo storage. The README explains production persistence.",
    "No API keys are requested or stored by this wizard.",
  ].join("\n"), "Review your project");
  if (!answer(await ui.confirm({ message: "Create this project?", initialValue: true }))) {
    ui.cancel("Setup cancelled. No project files were created.");
    throw new InitCancelled();
  }
  return { directory: directory.trim(), target, template, packageManager, install };
}

export async function installProject(directory: string, manager: "pnpm" | "npm" | "yarn" | "bun"): Promise<void> {
  await new Promise<void>((done, reject) => {
    // Windows package-manager shims are .cmd files. Only the fixed, typed
    // executable and argument go through cmd; the user path stays in cwd.
    const command = process.platform === "win32" ? "cmd.exe" : manager;
    const args = process.platform === "win32" ? ["/d", "/s", "/c", `${manager} install`] : ["install"];
    const child = spawn(command, args, { cwd: directory, stdio: "inherit", shell: false });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? done() : reject(new Error(`Dependency installation exited with code ${code ?? "signal"}.`)));
  });
}

export function useInteractiveInit(flags: Readonly<Record<string, string | boolean>>, terminal: boolean): boolean {
  if (flags.interactive && (flags.yes || flags["no-interactive"])) throw new Error("--interactive cannot be combined with --yes or --no-interactive.");
  if (flags.interactive && !terminal) throw new Error("Interactive setup needs a terminal. Use --yes with explicit options in scripts.");
  return terminal && !flags.yes && !flags["no-interactive"];
}
