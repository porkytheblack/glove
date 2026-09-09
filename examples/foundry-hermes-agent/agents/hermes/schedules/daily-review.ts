import { defineSchedule } from "glove-foundry";

export default defineSchedule({
  name: "daily-review",
  description: "Review open tasks, inbox items, and learned procedures every morning.",
  timing: { kind: "cron", expression: "0 8 * * *", timezone: "UTC" },
  message: "Review the shared inbox, open tasks, and recent memory. Resolve actionable work and report blockers.",
});
