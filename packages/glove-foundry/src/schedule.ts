import { createHash } from "node:crypto";
import { Duration } from "effect";
import { validateCron } from "station-schedules";

export const FOUNDRY_SCHEDULE_BRAND = Symbol.for("glove-foundry-schedule");

/**
 * What a recurring schedule does about occurrences that passed while the
 * runtime was not running. `fire-once` (default) delivers the earliest missed
 * occurrence and folds the rest into it; `catch-up` delivers every one in
 * order; `skip` drops an occurrence more than a minute late.
 */
export type FoundryScheduleMisfirePolicy = "fire-once" | "skip" | "catch-up";

export type FoundryScheduleTimingInput =
  | { readonly kind: "at"; readonly at: string }
  | { readonly kind: "after"; readonly duration: string }
  | { readonly kind: "every"; readonly interval: string; readonly misfire?: FoundryScheduleMisfirePolicy }
  | { readonly kind: "cron"; readonly expression: string; readonly timezone?: string; readonly misfire?: FoundryScheduleMisfirePolicy };

export type FoundryScheduleTiming =
  | { readonly kind: "at"; readonly at: string }
  | { readonly kind: "every"; readonly intervalMs: number; readonly misfire?: FoundryScheduleMisfirePolicy }
  | { readonly kind: "cron"; readonly expression: string; readonly timezone: string; readonly misfire?: FoundryScheduleMisfirePolicy };

export interface DefineFoundryScheduleOptions {
  /** Stable semantic name within one agent definition. It is not a runtime id. */
  readonly name: string;
  readonly description?: string;
  readonly message: string;
  readonly payload?: unknown;
  readonly timing: FoundryScheduleTimingInput;
  readonly enabled?: boolean;
}

export type FoundryScheduleDefinition = Readonly<DefineFoundryScheduleOptions> & {
  readonly [FOUNDRY_SCHEDULE_BRAND]: true;
};

const COMPACT_DURATION = /^(\d+)\s*(ms|s|m|h|d|w)$/i;

export function durationMillis(value: string): number {
  const compact = value.match(COMPACT_DURATION);
  const input = compact
    ? `${compact[1]} ${({ ms: "millis", s: "seconds", m: "minutes", h: "hours", d: "days", w: "weeks" } as const)[compact[2]!.toLowerCase() as "ms" | "s" | "m" | "h" | "d" | "w"]}`
    : value;
  const milliseconds = Duration.toMillis(Duration.decode(input as Duration.DurationInput));
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    throw new Error("Duration must be finite and greater than zero.");
  }
  return milliseconds;
}

function misfirePolicy(value: string): FoundryScheduleMisfirePolicy {
  if (value === "fire-once" || value === "skip" || value === "catch-up") return value;
  throw new Error(`Unknown misfire policy "${value}".`);
}

export function normalizeScheduleTiming(
  timing: FoundryScheduleTimingInput,
  now = Date.now(),
): FoundryScheduleTiming {
  if (timing.kind === "after") {
    return Object.freeze({ kind: "at", at: new Date(now + durationMillis(timing.duration)).toISOString() });
  }
  if (timing.kind === "every") {
    return Object.freeze({
      kind: "every", intervalMs: durationMillis(timing.interval),
      ...(timing.misfire ? { misfire: misfirePolicy(timing.misfire) } : {}),
    });
  }
  if (timing.kind === "cron") {
    if (!timing.expression.trim()) throw new Error("A cron expression is required.");
    const timezone = timing.timezone ?? "UTC";
    validateCron(timing.expression, timezone);
    return Object.freeze({
      kind: "cron", expression: timing.expression, timezone,
      ...(timing.misfire ? { misfire: misfirePolicy(timing.misfire) } : {}),
    });
  }
  const at = new Date(timing.at);
  if (Number.isNaN(at.getTime())) throw new Error(`Invalid schedule date "${timing.at}".`);
  return Object.freeze({ kind: "at", at: at.toISOString() });
}

export function defineSchedule(options: DefineFoundryScheduleOptions): FoundryScheduleDefinition {
  if (!options.name.trim()) throw new Error("A Foundry schedule name is required.");
  if (!options.message.trim()) throw new Error("A Foundry schedule message is required.");
  normalizeScheduleTiming(options.timing);
  return Object.freeze({
    ...options,
    ...(options.payload !== undefined ? { payload: structuredClone(options.payload) } : {}),
    timing: Object.freeze({ ...options.timing }),
    enabled: options.enabled ?? true,
    [FOUNDRY_SCHEDULE_BRAND]: true as const,
  });
}

export function isFoundrySchedule(value: unknown): value is FoundryScheduleDefinition {
  return Boolean(value && typeof value === "object" &&
    (value as Record<PropertyKey, unknown>)[FOUNDRY_SCHEDULE_BRAND] === true);
}

/** Deterministic runtime identity derived by Foundry; agent code never passes it. */
export function agentScheduleActivationId(definitionId: string, agentId: string, name: string): string {
  const digest = createHash("sha256")
    .update(`${definitionId}\0${agentId}\0${name}`)
    .digest("hex")
    .slice(0, 24);
  return `activation_${digest}`;
}

export function agentScheduleRevision(schedule: FoundryScheduleDefinition): string {
  return createHash("sha256")
    .update(JSON.stringify({
      message: schedule.message,
      payload: schedule.payload,
      timing: schedule.timing,
      enabled: schedule.enabled !== false,
    }))
    .digest("hex");
}
