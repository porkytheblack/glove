/**
 * Durable schedule occurrences.
 *
 * Every time an activation (a recurring schedule, a one-shot schedule or a
 * sleep) comes due, Foundry records one occurrence before it moves the
 * activation's cursor past it, then hands the occurrence to the agent's
 * conversation under the same identity. A crash at any point leaves either
 * nothing (the cursor still points at the due time, so it fires again) or a
 * stored obligation (replayed on startup). The occurrence id never changes
 * across retries, so it can key idempotent side effects.
 */
import { createHash } from "node:crypto";
import { nextCronOccurrence } from "station-schedules";
import type { FoundryActivationRecord, FoundryRequest } from "./primitives.js";
import type { FoundryScheduleMisfirePolicy, FoundryScheduleTiming } from "./schedule.js";

/**
 * pending: claimed, not yet handed to a run (or the run that had it was lost).
 * accepted: a run has it. completed / failed: that run settled.
 * skipped: deliberately not delivered (a missed occurrence under `misfire: "skip"`).
 * cancelled: the activation was paused, cancelled or changed before delivery, or its run was cancelled.
 */
export type FoundryScheduleOccurrenceStatus =
  | "pending"
  | "accepted"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled";

export interface FoundryScheduleOccurrence {
  /** Deterministic: activation id, schedule revision and scheduled time. */
  readonly id: string;
  readonly activationId: string;
  /** The activation's schedule revision when this occurrence was claimed. */
  readonly revision: string;
  /** The time the schedule meant, independent of when it was claimed, run or finished. */
  readonly scheduledFor: string;
  readonly definitionId: string;
  readonly agentId: string;
  readonly conversationId: string;
  readonly workspaceId: string;
  /** The request a run for this occurrence starts from; `source.occurrenceId` is this id. */
  readonly request: FoundryRequest;
  readonly status: FoundryScheduleOccurrenceStatus;
  /** Why it was skipped or cancelled: misfire, paused, cancelled, superseded, agent-inactive, run-cancelled. */
  readonly reason?: string;
  /** The run handling it now, or the run that settled it. */
  readonly runId?: string;
  /** Every run it was handed to, oldest first. More than one means a retry after a crash. */
  readonly runIds?: ReadonlyArray<string>;
  /** Handoffs so far. */
  readonly attempts: number;
  /** Later occurrences that also passed while the runtime was down and were folded into this one (`fire-once`). */
  readonly coalesced?: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly acceptedAt?: string;
  readonly settledAt?: string;
}

export interface FoundryScheduleOccurrenceFilter {
  readonly activationId?: string;
  readonly workspaceId?: string;
  readonly agentId?: string;
  readonly status?: FoundryScheduleOccurrenceStatus | ReadonlyArray<FoundryScheduleOccurrenceStatus>;
}

export const TERMINAL_OCCURRENCE_STATUSES: ReadonlySet<FoundryScheduleOccurrenceStatus> =
  new Set(["completed", "failed", "skipped", "cancelled"]);

/** How long a missed occurrence still counts as on time under `misfire: "skip"`. */
export const SCHEDULE_MISFIRE_GRACE_MS = 60_000;

/**
 * Terminal occurrences the bundled adapters keep per activation. Older ones
 * are behind the activation's cursor, so no new claim can collide with them.
 */
export const RETAINED_TERMINAL_OCCURRENCES = 100;

type ScheduleConfiguration = Pick<FoundryActivationRecord,
  "definitionId" | "agentId" | "conversationId" | "message" | "payload" | "timing">;

/**
 * JSON text with every object's keys sorted, recursively. Values go through
 * JSON first, so `undefined` members, `toJSON` and the rest of JSON's rules
 * apply as before; array order is kept. Stores that reorder object keys
 * (PostgreSQL `jsonb` does) therefore leave it unchanged.
 */
export function canonicalJson(value: unknown): string {
  const text = JSON.stringify(value);
  if (text === undefined) return "null";
  const sort = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sort);
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      return Object.fromEntries(Object.keys(record).sort().map((key) => [key, sort(record[key])]));
    }
    return item;
  };
  return JSON.stringify(sort(JSON.parse(text)));
}

function configuration(activation: ScheduleConfiguration) {
  return {
    definitionId: activation.definitionId,
    agentId: activation.agentId,
    conversationId: activation.conversationId,
    message: activation.message,
    payload: activation.payload ?? null,
    timing: activation.timing,
  };
}

/**
 * The schedule configuration an occurrence belongs to. It changes only when
 * what the schedule delivers, to whom, or when changes; status and timestamp
 * writes leave it alone, and so does the order a store returns object keys in.
 */
export function activationScheduleRevision(activation: ScheduleConfiguration): string {
  return createHash("sha256").update(canonicalJson(configuration(activation))).digest("hex");
}

function permutations<T>(items: ReadonlyArray<T>): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
}

/**
 * Revisions glove-foundry 0.10.0 could have stored for this configuration. It
 * hashed `JSON.stringify` of the record as stored, so the result depended on
 * key order: this tries the timing's keys in every order (at most four keys)
 * with the payload as stored. A payload whose keys a store reordered since
 * cannot be matched.
 */
function legacyScheduleRevisions(activation: ScheduleConfiguration): string[] {
  const timing = activation.timing as unknown as Record<string, unknown>;
  return permutations(Object.keys(timing)).map((keys) =>
    createHash("sha256").update(JSON.stringify({
      ...configuration(activation),
      timing: Object.fromEntries(keys.map((key) => [key, timing[key]])),
    })).digest("hex"));
}

/**
 * Whether a stored revision belongs to this configuration: the canonical
 * revision, or one 0.10.0 stored for it. A matching stored revision is kept
 * as it is, so occurrence ids derived from it do not change.
 */
export function scheduleRevisionMatches(activation: ScheduleConfiguration, revision: string): boolean {
  return revision === activationScheduleRevision(activation) || legacyScheduleRevisions(activation).includes(revision);
}

export function scheduleOccurrenceId(activationId: string, revision: string, scheduledFor: string): string {
  const instant = new Date(scheduledFor).toISOString();
  return `occurrence_${createHash("sha256").update(JSON.stringify([activationId, revision, instant])).digest("hex")}`;
}

export function scheduleMisfirePolicy(timing: FoundryScheduleTiming): FoundryScheduleMisfirePolicy {
  return timing.kind === "at" ? "fire-once" : timing.misfire ?? "fire-once";
}

/** The first occurrence strictly after `after`. One-shot timing has none after its time. */
export function nextScheduledTime(timing: FoundryScheduleTiming, after: Date): Date | undefined {
  if (timing.kind === "every") return new Date(after.getTime() + timing.intervalMs);
  if (timing.kind === "cron") return nextCronOccurrence(timing.expression, timing.timezone, after);
  const at = new Date(timing.at);
  return at.getTime() > after.getTime() ? at : undefined;
}

/** Where a new (or changed) activation's cursor starts. */
export function firstScheduledTime(timing: FoundryScheduleTiming, now: Date): Date {
  if (timing.kind === "at") return new Date(timing.at);
  return nextScheduledTime(timing, now)!;
}

export interface ScheduleOccurrencePlan {
  /** Deliver the occurrence at the cursor, or record it as skipped. */
  readonly deliver: boolean;
  /** Where the cursor moves next; absent when the activation has no more occurrences. */
  readonly next?: Date;
  /** Further occurrences that already passed and are folded into this one (`fire-once`). */
  readonly coalesced: number;
}

/**
 * What to do with the occurrence at `scheduledFor`, now due at `now`.
 *
 * - `fire-once` (default): deliver it with its original `scheduledFor`; any
 *   later occurrences that also passed are folded into it, and the cursor
 *   moves to the first occurrence after now.
 * - `catch-up`: deliver it; the cursor moves to the very next occurrence even
 *   when that has passed too, so every missed occurrence is delivered in turn.
 * - `skip`: deliver it only when it is at most a minute late; otherwise record
 *   it as skipped and move the cursor past now.
 */
export function planScheduleOccurrence(
  timing: FoundryScheduleTiming,
  scheduledFor: Date,
  now: Date,
): ScheduleOccurrencePlan {
  const policy = scheduleMisfirePolicy(timing);
  let next = nextScheduledTime(timing, scheduledFor);
  if (policy === "catch-up" || !next) {
    return { deliver: true, ...(next ? { next } : {}), coalesced: 0 };
  }
  let coalesced = 0;
  while (next.getTime() <= now.getTime()) {
    coalesced++;
    next = nextScheduledTime(timing, next)!;
  }
  const late = now.getTime() - scheduledFor.getTime() > SCHEDULE_MISFIRE_GRACE_MS;
  if (policy === "skip" && late) return { deliver: false, next, coalesced: 0 };
  return { deliver: true, next, coalesced };
}

export function matchesOccurrenceFilter(
  occurrence: FoundryScheduleOccurrence,
  filter: FoundryScheduleOccurrenceFilter = {},
): boolean {
  if (filter.activationId && occurrence.activationId !== filter.activationId) return false;
  if (filter.workspaceId && occurrence.workspaceId !== filter.workspaceId) return false;
  if (filter.agentId && occurrence.agentId !== filter.agentId) return false;
  if (filter.status) {
    const statuses = typeof filter.status === "string" ? [filter.status] : filter.status;
    if (!statuses.includes(occurrence.status)) return false;
  }
  return true;
}

export function compareOccurrences(left: FoundryScheduleOccurrence, right: FoundryScheduleOccurrence): number {
  return left.scheduledFor.localeCompare(right.scheduledFor) || left.id.localeCompare(right.id);
}

/**
 * Keep every open occurrence and the latest terminal ones per activation.
 * Returns the ids to drop. Used by the bundled adapters after each write.
 */
export function prunableOccurrences(
  occurrences: Iterable<FoundryScheduleOccurrence>,
  activationId: string,
  keep = RETAINED_TERMINAL_OCCURRENCES,
): string[] {
  const terminal = [...occurrences]
    .filter((item) => item.activationId === activationId && TERMINAL_OCCURRENCE_STATUSES.has(item.status))
    .sort(compareOccurrences);
  return terminal.slice(0, Math.max(0, terminal.length - keep)).map((item) => item.id);
}

/** Validates an occurrence before an adapter stores it. */
export function assertScheduleOccurrence(occurrence: FoundryScheduleOccurrence): void {
  if (!occurrence.id.startsWith("occurrence_")) throw new Error("Schedule occurrence id is invalid.");
  if (!occurrence.activationId || !occurrence.revision) throw new Error("Schedule occurrence must name its activation and revision.");
  if (Number.isNaN(Date.parse(occurrence.scheduledFor))) throw new Error("Schedule occurrence has an invalid scheduled time.");
}
