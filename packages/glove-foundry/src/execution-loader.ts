import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import type { FoundryAgentConventionModule } from "./definition.js";
import { compileAgentModule } from "./agent-runtime.js";
import { bindAgentLocalDefinitions } from "./discovery.js";

/** Private Station signal module loader. Explicit identity avoids process-global discovery races. */
export async function loadExecutionAgent(route: string, file: string) {
  const module = await import(pathToFileURL(file).href) as FoundryAgentConventionModule;
  await bindAgentLocalDefinitions(dirname(file));
  return compileAgentModule(route, module);
}
