import { pathToFileURL } from "node:url";
import { dirname } from "node:path";
import {
  FOUNDRY_AGENT_FILE_ENV,
  FOUNDRY_AGENT_ROUTE_ENV,
  type FoundryAgentConventionModule,
} from "./definition.js";
import { compileAgentModule } from "./agent-runtime.js";
import { bindAgentLocalDefinitions } from "./discovery.js";

const route = process.env[FOUNDRY_AGENT_ROUTE_ENV];
const file = process.env[FOUNDRY_AGENT_FILE_ENV];

if (!route || !file) {
  throw new Error(
    "The Foundry execution entrypoint requires GLOVE_FOUNDRY_AGENT_ROUTE and GLOVE_FOUNDRY_AGENT_FILE.",
  );
}

const module = (await import(pathToFileURL(file).href)) as FoundryAgentConventionModule;
await bindAgentLocalDefinitions(dirname(file));

/** Private execution-backend entrypoint; application modules remain definitions. */
export default compileAgentModule(route, module);
