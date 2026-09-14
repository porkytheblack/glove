import { defineSchedule } from "glove-foundry";

/**
 * Agents never call setTimeout. A schedule is a definition; Foundry persists
 * the activation and wakes the agent with this message. Watch it appear under
 * Automations in the inspector.
 */
const tripCountdown = defineSchedule({
  name: "trip-countdown",
  description: "Check every weekday whether an upcoming trip still needs work.",
  timing: { kind: "cron", expression: "0 8 * * 1-5", timezone: "UTC" },
  message:
    "Review any held trip dates and unconfirmed bookings. If something needs the traveller's decision, say exactly what and why.",
});

export default tripCountdown;
