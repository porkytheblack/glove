import { defineSchedule } from "glove-foundry";
import { DEFAULT_PREFERENCES, type Preferences } from "../../lib/onboarding.js";

/**
 * The partner's own clock, built from the person's data: their time zone, when
 * they want the brief, and the hours worth a look. Change the preferences and
 * the next run moves the schedule; no code changes.
 */
export function partnerSchedules(context: Readonly<Record<string, unknown>>) {
  const timezone = String(context.timezone ?? "UTC");
  const preferences = (context.preferences ?? DEFAULT_PREFERENCES) as Preferences;
  const [hour = "7", minute = "30"] = preferences.briefAt.split(":");
  return [
    defineSchedule({
      name: "morning-brief",
      timing: { kind: "cron", expression: `${Number(minute)} ${Number(hour)} * * *`, timezone },
      message:
        "Morning brief. Read the inbox and today's calendar, then send one short brief with notify_person: what needs them today, in order, and any clash you can fix. Reply with the same brief.",
    }),
    defineSchedule({
      name: "check-in",
      timing: { kind: "cron", expression: `0 ${preferences.checkInHours.join(",")} * * *`, timezone },
      message:
        "Check-in. Read the inbox. If something they want to hear about needs them before the next check-in, notify_person once, saying what and why. Otherwise do not notify, and reply exactly: (nothing new)",
    }),
  ];
}
