import { composeAgent } from "glove-foundry";
import * as statusBody from "./tools/status.tool.js";
import knowledge from "./tools/knowledge.tool.js";
import messaging from "./apps/messaging.app.js";
import mediaStudio from "./apps/media-studio.app.js";
import externalTools from "./mcp/external-tools.mcp.js";
import personal from "./memory/personal.memory.js";
import executionContext from "./layers/execution-context.layer.js";
import trace from "./subscribers/trace.subscriber.js";

const statusComposition = composeAgent(statusBody);

/** Direct definition reference for instance installation; no duplicated string id. */
export const status = statusComposition.capabilities.tools[0]!;

export const hermesComponents = composeAgent(
  statusComposition,
  knowledge,
  messaging,
  mediaStudio,
  externalTools,
  personal,
  executionContext,
  trace,
);
