import {
  FOUNDRY_AGENT_FILE_ENV,
  FOUNDRY_AGENT_ROUTE_ENV,
} from "./definition.js";

const route = process.env[FOUNDRY_AGENT_ROUTE_ENV];
const file = process.env[FOUNDRY_AGENT_FILE_ENV];

if (!route || !file) {
  throw new Error(
    "The Foundry execution entrypoint requires GLOVE_FOUNDRY_AGENT_ROUTE and GLOVE_FOUNDRY_AGENT_FILE.",
  );
}

const { loadExecutionAgent } = await import("./execution-loader.js");
export default await loadExecutionAgent(route, file);
