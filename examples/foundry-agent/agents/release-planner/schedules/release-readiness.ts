import { defineSchedule } from "glove-foundry";

/** A composable agent-local primitive. Foundry derives its runtime id on load. */
const releaseReadiness = defineSchedule({
  name: "release-readiness",
  description: "Review release readiness every weekday morning.",
  timing: { kind: "cron", expression: "0 9 * * 1-5", timezone: "UTC" },
  message:
    "Review the current release plan, unresolved workspace tasks, and operations inbox. Resolve anything actionable and report blockers.",
});

export default releaseReadiness;
