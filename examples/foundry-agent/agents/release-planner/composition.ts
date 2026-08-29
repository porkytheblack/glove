import { composeAgent } from "glove-foundry";
import requestContext from "./layers/request-context.layer.js";
import releaseNotes from "./apps/release-notes.app.js";
import projectTracker from "./mcp/project-tracker.mcp.js";
import releaseContext from "./memory/release-context.memory.js";
import runAudit from "./subscribers/run-audit.subscriber.js";
import releaseClock from "./tools/release-clock.tool.js";

/** Atomic default exports compose by direct reference; filenames own identity. */
export const releasePlannerComponents = composeAgent(
  releaseNotes,
  releaseClock,
  projectTracker,
  releaseContext,
  requestContext,
  runAudit,
);
