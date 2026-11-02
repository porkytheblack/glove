import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Render the runnable example itself, so copied documentation cannot drift from it.
const directory = [resolve(process.cwd(), "../../examples/foundry-durable-research"), resolve(process.cwd(), "examples/foundry-durable-research")]
  .find((path) => existsSync(resolve(path, "package.json")));
if (!directory) throw new Error("Build Foundry docs from the repository checkout: durable research example is missing.");
// Keep the agent-readable feature reference aligned with the package guide.
export const durableSubagentsGuide = readFileSync(resolve(directory, "../../packages/glove-foundry/docs/durable-subagents.md"), "utf8");
export const durableResearchPaths = [
  "package.json", "tsconfig.json", "foundry.application.ts", "foundry.config.ts",
  "agents/front/agent.ts", "agents/front/live.ts", "agents/front/personal.memory.ts",
  "agents/front/library.app.ts", "agents/front/tools.ts", "agents/researcher/agent.ts",
  "lib/models.ts", "lib/corpus.ts", "lib/paths.ts", "lib/file-store.ts", "lib/room.ts", "lib/room.html",
  "scripts/start.ts", "scripts/message.ts", "scripts/verify.ts", "scripts/verify-live.ts", "scripts/live-controller.ts", "README.md",
] as const;
export const durableResearchFiles = Object.fromEntries(durableResearchPaths.map((path) => [path, readFileSync(resolve(directory, path), "utf8")])) as Record<(typeof durableResearchPaths)[number], string>;
export const durableResearchSource = durableResearchPaths.map((path) => {
  const fence = path.endsWith(".md") ? "````" : "```";
  const language = path.endsWith(".json") ? "json" : path.endsWith(".html") ? "html" : path.endsWith(".md") ? "markdown" : "typescript";
  return `### ${path}\n\n${fence}${language}\n${durableResearchFiles[path]}\n${fence}`;
}).join("\n\n");
