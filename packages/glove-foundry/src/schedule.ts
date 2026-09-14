import { createHash } from "node:crypto";
import { Duration } from "effect";

export const FOUNDRY_SCHEDULE_BRAND = Symbol.for("glove-foundry-schedule");

export type FoundryScheduleTimingInput =
  | { readonly kind: "at"; readonly at: string }
  | { readonly kind: "after"; readonly duration: string }
  | { readonly kind: "every"; readonly interval: string }
  | { readonly kind: "cron"; readonly expression: string; readonly timezone?: string };

export type FoundryScheduleTiming =
  | { readonly kind: "at"; readonly at: string }
  | { readonly kind: "every"; readonly intervalMs: number }
  | { readonly kind: "cron"; readonly expression: string; readonly timezone: string };

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

export function normalizeScheduleTiming(
  timing: FoundryScheduleTimingInput,
  now = Date.now(),
): FoundryScheduleTiming {
  if (timing.kind === "after") {
    return Object.freeze({ kind: "at", at: new Date(now + durationMillis(timing.duration)).toISOString() });
  }
  if (timing.kind === "every") {
    return Object.freeze({ kind: "every", intervalMs: durationMillis(timing.interval) });
  }
  if (timing.kind === "cron") {
    if (!timing.expression.trim()) throw new Error("A cron expression is required.");
    return Object.freeze({ kind: "cron", expression: timing.expression, timezone: timing.timezone ?? "UTC" });
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
