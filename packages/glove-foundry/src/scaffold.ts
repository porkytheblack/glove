import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveTemplateVersions,
  type FoundryTemplateVersions,
  type TemplateDependency,
} from "./scaffold-versions.js";

export type FoundryTemplateName = "travel-concierge" | "minimal";

/**
 * `standalone` owns its package.json. `nextjs` joins one that already exists,
 * so the agents sit beside the app that calls them instead of in a sibling
 * repository nobody remembers to deploy.
 */
export type FoundryScaffoldTarget = "standalone" | "nextjs";

export type FoundryPackageManager = "pnpm" | "npm" | "yarn" | "bun";

export interface ScaffoldOptions {
  readonly directory: string;
  /** Defaults to the travel concierge, which exercises every convention. */
  readonly template?: FoundryTemplateName;
  /** Omit to detect: a directory holding a Next.js app gets the nextjs target. */
  readonly target?: FoundryScaffoldTarget;
  readonly packageManager?: FoundryPackageManager;
}

export interface ScaffoldResult {
  readonly rootDir: string;
  readonly files: string[];
  readonly template: FoundryTemplateName;
  readonly target: FoundryScaffoldTarget;
  readonly packageManager: FoundryPackageManager;
  /** Where agents were written, relative to rootDir. */
  readonly agentsDir: string;
  readonly versions: FoundryTemplateVersions;
  /** The example agent's route, for the "what next" hints. */
  readonly agentRoute: string;
}

export const FOUNDRY_TEMPLATES: ReadonlyArray<FoundryTemplateName> = [
  "travel-concierge",
  "minimal",
];

/** Every package a template imports, so an unused one is never installed. */
const TEMPLATE_IMPORTS: Readonly<Record<FoundryTemplateName, ReadonlyArray<TemplateDependency>>> =
  Object.freeze({
    "travel-concierge": [
      "effect",
      "glove-core",
      "glove-js",
      "glove-memory",
      "glove-working-environment",
      "zod",
    ],
    minimal: ["effect", "glove-core", "zod"],
  });

const TEMPLATE_AGENT_ROUTE: Readonly<Record<FoundryTemplateName, string>> = Object.freeze({
  "travel-concierge": "concierge",
  minimal: "assistant",
});

/** Files whose names cannot live in the published package under their real name. */
const RENAMED_ON_COPY: Readonly<Record<string, string>> = Object.freeze({
  gitignore: ".gitignore",
  "env.example": ".env.example",
});

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function templatesRoot(): string {
  // dist/scaffold.js and src/scaffold.ts both sit one level below the package
  // root, so one relative path serves the built and the source tree.
  return resolve(dirname(fileURLToPath(import.meta.url)), "../templates");
}

async function walk(root: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(resolve(root, prefix), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await walk(root, relativePath)));
    else files.push(relativePath);
  }
  return files.sort();
}

function projectNameFrom(rootDir: string): string {
  return (
    basename(rootDir)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-|-$/g, "") || "glove-foundry-app"
  );
}

function runner(packageManager: FoundryPackageManager, script: string): string {
  if (packageManager === "npm") return `npm run ${script}`;
  return `${packageManager} ${script}`;
}

function installCommand(packageManager: FoundryPackageManager): string {
  return packageManager === "yarn" ? "yarn" : `${packageManager} install`;
}

/**
 * Detect the surrounding project. A Next.js app is the case worth special
 * handling: its author wants the agents in the same repository as the routes
 * that call them.
 */
export async function detectScaffoldTarget(
  rootDir: string,
): Promise<FoundryScaffoldTarget> {
  for (const config of [
    "next.config.js",
    "next.config.mjs",
    "next.config.ts",
    "next.config.cjs",
  ]) {
    if (await exists(resolve(rootDir, config))) return "nextjs";
  }
  try {
    const manifest = JSON.parse(
      await readFile(resolve(rootDir, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    if (manifest.dependencies?.next ?? manifest.devDependencies?.next) return "nextjs";
  } catch {
    // No manifest, or an unreadable one: treat it as a fresh project.
  }
  return "standalone";
}

export async function detectPackageManager(
  rootDir: string,
): Promise<FoundryPackageManager> {
  if (await exists(resolve(rootDir, "pnpm-lock.yaml"))) return "pnpm";
  if (await exists(resolve(rootDir, "yarn.lock"))) return "yarn";
  if (await exists(resolve(rootDir, "bun.lockb"))) return "bun";
  if (await exists(resolve(rootDir, "package-lock.json"))) return "npm";
  const agent = process.env.npm_config_user_agent ?? "";
  if (agent.startsWith("yarn")) return "yarn";
  if (agent.startsWith("bun")) return "bun";
  if (agent.startsWith("npm")) return "npm";
  return "pnpm";
}

function fill(content: string, values: Readonly<Record<string, string>>): string {
  return content.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    Object.hasOwn(values, key) ? values[key]! : match,
  );
}

function dependenciesFor(
  template: FoundryTemplateName,
  versions: FoundryTemplateVersions,
): Record<string, string> {
  const dependencies: Record<string, string> = { "glove-foundry": versions.foundry };
  for (const name of TEMPLATE_IMPORTS[template]) {
    dependencies[name] = versions.dependencies[name];
  }
  return Object.fromEntries(
    Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b)),
  );
}

const DEV_DEPENDENCIES = Object.freeze({
  "@types/node": "^25.2.3",
  eslint: "^9.39.2",
  typescript: "^5.9.3",
  "typescript-eslint": "^8.54.0",
});

function routesDeclaration(agentsDir: string, route: string): string {
  // This file is written to .foundry/, so the project root is one level up.
  return (
    "// Generated by Glove Foundry. Do not edit.\n" +
    "export type FoundryRoutes = {\n" +
    `  readonly "${route}": typeof import("../${agentsDir}/${route}/agent.js").default;\n` +
    "};\n"
  );
}

export async function scaffoldFoundryProject(
  options: ScaffoldOptions,
): Promise<ScaffoldResult> {
  const rootDir = resolve(options.directory);
  const template = options.template ?? "travel-concierge";
  if (!FOUNDRY_TEMPLATES.includes(template)) {
    throw new Error(
      `Unknown Foundry template "${template}". Available: ${FOUNDRY_TEMPLATES.join(", ")}.`,
    );
  }
  const templateDir = resolve(templatesRoot(), template);
  if (!(await exists(templateDir))) {
    throw new Error(`Foundry template "${template}" is missing from this install.`);
  }

  const target = options.target ?? (await detectScaffoldTarget(rootDir));
  const packageManager =
    options.packageManager ?? (await detectPackageManager(rootDir));

  // A standalone project owns the directory; joining a Next.js app does not.
  if (target === "standalone" && (await exists(rootDir))) {
    const entries = await readdir(rootDir);
    if (entries.length > 0) {
      throw new Error(
        `Cannot scaffold into non-empty directory ${rootDir}. ` +
          "Pass --target nextjs to add Foundry to an existing project.",
      );
    }
  }
  await mkdir(rootDir, { recursive: true });

  const versions = await resolveTemplateVersions();
  const projectName = projectNameFrom(rootDir);
  const agentRoute = TEMPLATE_AGENT_ROUTE[template];
  // Next.js apps keep their root tidy: everything Foundry owns lives under foundry/.
  const foundryDir = target === "nextjs" ? "foundry" : "";
  const agentsDir = foundryDir ? `${foundryDir}/agents` : "agents";

  const devScript = target === "nextjs" ? "foundry:dev" : "dev";
  const startScript = target === "nextjs" ? "foundry:start" : "start";
  const placeholders = {
    projectName,
    installCommand: installCommand(packageManager),
    devCommand: runner(packageManager, devScript),
    startCommand: runner(packageManager, startScript),
    lintCommand: runner(packageManager, "lint"),
    typecheckCommand: runner(packageManager, "typecheck"),
  };

  const files = new Map<string, string>();

  // 1. Copy the template, relocating what the target moves.
  for (const relativePath of await walk(templateDir)) {
    const source = await readFile(resolve(templateDir, relativePath), "utf8");
    const name = basename(relativePath);
    const renamed = RENAMED_ON_COPY[name];
    let destination = renamed
      ? join(dirname(relativePath), renamed).split(sep).join("/")
      : relativePath;

    if (target === "nextjs") {
      // The app already has a README and a .gitignore; do not fight it. The
      // standalone client example is replaced by lib/foundry.ts.
      if (destination === "README.md" || destination === ".gitignore") continue;
      if (destination.startsWith("src/")) continue;
      // The standalone config is replaced by the .mts one written below.
      if (destination === "foundry.config.ts") continue;
      if (destination === ".env.example") destination = "foundry.env.example";
      else destination = `${foundryDir}/${destination}`;
    }
    files.set(destination, fill(source, placeholders));
  }

  // 2. Config names where the agents went, and the module system has to be
  //    stated explicitly. A Next.js app is not `"type": "module"`, so Node
  //    would load these through the CJS resolver and fail on Foundry's
  //    ESM-only export map. `.mts` is unambiguous whatever the root says, and
  //    a nested manifest makes the agent subtree ESM without touching the app.
  if (target === "nextjs") {
    files.set(
      "foundry.config.mts",
      'import { defineConfig } from "glove-foundry/config";\n\n' +
        "export default defineConfig({\n" +
        `  agentsDir: "${agentsDir}",\n` +
        `  applicationFile: "${foundryDir}/foundry.application.ts",\n` +
        "  server: { port: 4141 },\n" +
        "  execution: { pollIntervalMs: 100, maxConcurrent: 4 },\n" +
        "});\n",
    );
    files.set(
      `${foundryDir}/package.json`,
      `${JSON.stringify(
        {
          name: `${projectName}-foundry`,
          private: true,
          // Foundry and the Glove packages are ESM. This scopes that to the
          // agents, so the surrounding app keeps its own module system.
          type: "module",
        },
        null,
        2,
      )}\n`,
    );
  }

  files.set(".foundry/routes.d.ts", routesDeclaration(agentsDir, agentRoute));

  // 3. Manifest, tsconfig, and lint config differ by target.
  const dependencies = dependenciesFor(template, versions);
  if (target === "standalone") {
    files.set(
      "package.json",
      `${JSON.stringify(
        {
          name: projectName,
          version: "0.1.0",
          private: true,
          type: "module",
          scripts: {
            dev: "glove foundry dev",
            start: "glove foundry start",
            lint: "eslint .",
            typecheck: "tsc --noEmit",
          },
          dependencies,
          devDependencies: DEV_DEPENDENCIES,
        },
        null,
        2,
      )}\n`,
    );
    files.set(
      "tsconfig.json",
      `${JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            lib: ["ES2022", "DOM"],
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: true,
            noEmit: true,
            skipLibCheck: true,
          },
          include: [
            "agents",
            "lib",
            "src",
            "foundry.application.ts",
            "foundry.config.ts",
            ".foundry/routes.d.ts",
          ],
        },
        null,
        2,
      )}\n`,
    );
    files.set(
      "eslint.config.js",
      'import tseslint from "typescript-eslint";\n' +
        'import foundry from "glove-foundry/eslint";\n\n' +
        "export default [...tseslint.configs.recommended, foundry];\n",
    );
  } else {
    const [clientPath, clientSource] = nextClientModule(agentRoute, foundryDir);
    files.set(clientPath, clientSource);
    const [handlerPath, handlerSource] = nextRouteHandler(agentRoute);
    files.set(handlerPath, handlerSource);
    files.set(`${foundryDir}/README.md`, nextReadme(projectName, agentRoute, placeholders));
  }

  for (const [relativePath, content] of files) {
    const path = resolve(rootDir, relativePath);
    await mkdir(dirname(path), { recursive: true });
    // Never clobber a file an existing project already owns.
    if (target === "nextjs" && (await exists(path))) continue;
    await writeFile(path, content, { encoding: "utf8", flag: "wx" });
  }

  if (target === "nextjs") {
    await mergeNextManifest(rootDir, dependencies, files);
  }

  return {
    rootDir,
    files: [...files.keys()].sort(),
    template,
    target,
    packageManager,
    agentsDir,
    versions,
    agentRoute,
  };
}

function nextClientModule(route: string, foundryDir: string): [string, string] {
  return [
    "lib/foundry.ts",
    "/**\n" +
      " * The Next.js app talks to the Foundry runtime over HTTP, so nothing from\n" +
      " * the agent graph is bundled into your app. `FoundryRoutes` is a type-only\n" +
      " * import, erased at build time, and it is regenerated on every dev run — so\n" +
      ` * agent("${route}") is checked against the files that actually exist.\n` +
      " */\n" +
      'import { createFoundryClient } from "glove-foundry/client";\n' +
      'import type { FoundryRoutes } from "../.foundry/routes.js";\n\n' +
      "export const foundry = createFoundryClient<FoundryRoutes>({\n" +
      '  baseUrl: process.env.FOUNDRY_URL ?? "http://127.0.0.1:4141",\n' +
      "});\n\n" +
      `\n// The agents live in ${foundryDir}/agents. Start the runtime with\n` +
      "// `foundry:dev`; it serves the inspector at http://127.0.0.1:4141.\n",
  ];
}

function nextRouteHandler(route: string): [string, string] {
  return [
    `app/api/${route}/route.ts`,
    "/**\n" +
      ` * POST /api/${route} — send a message to the agent and wait for its result.\n` +
      " *\n" +
      " * This runs on the server, so the Foundry runtime never has to be public.\n" +
      " * For a streaming UI, subscribe to the runtime's /api/events instead of\n" +
      " * awaiting run.wait().\n" +
      " */\n" +
      'import { foundry } from "../../../lib/foundry.js";\n\n' +
      "export async function POST(request: Request) {\n" +
      "  const { message, workspaceId = \"default\" } = (await request.json()) as {\n" +
      "    message: string;\n" +
      "    workspaceId?: string;\n" +
      "  };\n\n" +
      "  // A real app reuses one instance per user rather than creating one per call.\n" +
      `  const agent = await foundry.agent("${route}").create({ workspaceId });\n` +
      "  const conversation = await foundry.createConversation(agent.id);\n" +
      "  const run = await foundry.send(agent.id, conversation.id, message);\n" +
      "  const completed = await run.wait();\n\n" +
      "  return Response.json({ runId: run.id, output: completed.output });\n" +
      "}\n",
  ];
}

function nextReadme(
  projectName: string,
  route: string,
  placeholders: Readonly<Record<string, string>>,
): string {
  return [
    `# Foundry agents for ${projectName}`,
    "",
    "The agents live here; the Next.js app calls them over HTTP through",
    "`lib/foundry.ts`. Nothing in this folder is bundled into your app.",
    "",
    "## Running",
    "",
    "Two processes, because they have different lifecycles — the runtime keeps",
    "durable state and should not restart when a React component changes:",
    "",
    "```bash",
    placeholders.devCommand + "      # Foundry runtime + inspector on :4141",
    placeholders.installCommand.split(" ")[0] + " dev              # Next.js on :3000",
    "```",
    "",
    "Then POST to your own route:",
    "",
    "```bash",
    `curl -X POST http://localhost:3000/api/${route} \\`,
    "  -H 'content-type: application/json' \\",
    `  -d '{"message":"I want to fly from Lisbon to Nairobi in April."}'`,
    "```",
    "",
    "## Layout",
    "",
    "| Path | What it is |",
    "| --- | --- |",
    `| \`foundry/agents/${route}/agent.ts\` | The agent. The file path is its id. |`,
    "| `foundry/foundry.application.ts` | Data adapter, accounts, routes |",
    "| `foundry.config.ts` | Points the runtime at `foundry/agents` |",
    "| `lib/foundry.ts` | Typed HTTP client for your app to import |",
    `| \`app/api/${route}/route.ts\` | An example Next.js route handler |`,
    "| `.foundry/routes.d.ts` | Generated. Do not edit |",
    "",
    "## Deploying",
    "",
    "The runtime is a normal Node process. Deploy it wherever you run servers,",
    "set `FOUNDRY_URL` in your Next.js environment to point at it, and keep it",
    "private to your network — the inspector is a development surface.",
    "",
    "See the [full Foundry guide](https://github.com/porkytheblack/glove/blob/main/packages/glove-foundry/docs/building-with-foundry.md).",
    "",
  ].join("\n");
}

/**
 * Add what Foundry needs to an existing manifest without disturbing what is
 * already there. Glove package versions are set rather than merged: they must
 * match the versions this Foundry was built against, or npm installs a second
 * copy of every shared class and the project stops typechecking.
 */
async function mergeNextManifest(
  rootDir: string,
  dependencies: Readonly<Record<string, string>>,
  files: Map<string, string>,
): Promise<void> {
  const path = resolve(rootDir, "package.json");
  let manifest: Record<string, unknown> = {};
  if (await exists(path)) {
    manifest = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  }
  const scripts = { ...(manifest.scripts as Record<string, string> | undefined) };
  scripts["foundry:dev"] ??= "glove foundry dev";
  scripts["foundry:start"] ??= "glove foundry start";
  const merged = {
    ...manifest,
    scripts,
    dependencies: Object.fromEntries(
      Object.entries({
        ...(manifest.dependencies as Record<string, string> | undefined),
        ...dependencies,
      }).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
  await writeFile(path, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  files.set("package.json", "(merged)");
}

/** Relative path for the CLI's "cd here" hint. */
export function displayPath(rootDir: string): string {
  return relative(process.cwd(), rootDir) || ".";
}
