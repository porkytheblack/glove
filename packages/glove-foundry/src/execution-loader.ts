import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import type { FoundryAgentConventionModule } from "./definition.js";
import { compileAgentModule } from "./agent-runtime.js";
import { bindAgentLocalDefinitions, discoverAgents, routeFromAgentFile } from "./discovery.js";

/** Private Station signal module loader. Explicit identity avoids process-global discovery races. */
export async function loadExecutionAgent(route: string, file: string) {
  if (route.includes("/workers/")) {
    const root = route.split("/workers/")[0]!;
    let agentsDir = dirname(file);
    while (routeFromAgentFile(agentsDir, file) !== root) {
      const next = dirname(agentsDir);
      if (next === agentsDir) throw new Error(`Cannot locate agent root for "${route}".`);
      agentsDir = next;
    }
    const found = (await discoverAgents({ agentsDir })).find((agent) => agent.route === route);
    if (!found) throw new Error(`Durable subagent definition "${route}" was not found.`);
    return compileAgentModule(route, { default: found.definition });
  }
  const module = await import(pathToFileURL(file).href) as FoundryAgentConventionModule;
  await bindAgentLocalDefinitions(dirname(file));
  return compileAgentModule(route, module);
}
