import type { FieldHistory, FormEntry, FormInstance } from "./types";

/**
 * Reading and moving through a field's answer log.
 *
 * The log is append-only and the cursor is the only thing that moves, so every
 * operation here is either a lookup or pointer arithmetic. Nothing in this
 * file can lose an answer.
 */

export const EMPTY_HISTORY: FieldHistory = { revisions: [], cursor: -1 };

/** The revision in force, or undefined when the field currently has no answer. */
export function inForce(history: FieldHistory | undefined): FormEntry | undefined {
  if (!history) return undefined;
  if (history.cursor < 0 || history.cursor >= history.revisions.length) return undefined;
  const entry = history.revisions[history.cursor];
  return entry?.retracted ? undefined : entry;
}

/** The revision the cursor points at, retraction included. */
export function atCursor(history: FieldHistory | undefined): FormEntry | undefined {
  if (!history) return undefined;
  if (history.cursor < 0 || history.cursor >= history.revisions.length) return undefined;
  return history.revisions[history.cursor];
}

export function canUndo(history: FieldHistory | undefined): boolean {
  return Boolean(history && history.cursor >= 0);
}

export function canRedo(history: FieldHistory | undefined): boolean {
  return Boolean(history && history.cursor < history.revisions.length - 1);
}

/** The revision a redo would move onto. */
export function redoTarget(history: FieldHistory | undefined): FormEntry | undefined {
  if (!canRedo(history)) return undefined;
  return history!.revisions[history!.cursor + 1];
}

/** The revision an undo would move back onto — undefined when it would go empty. */
export function undoTarget(history: FieldHistory | undefined): FormEntry | undefined {
  if (!canUndo(history)) return undefined;
  const next = history!.cursor - 1;
  if (next < 0) return undefined;
  const entry = history!.revisions[next];
  return entry?.retracted ? undefined : entry;
}

/**
 * The field whose in-force revision is the most recent anywhere on the
 * instance — what a bare "undo that" should take back.
 *
 * Ordering is by `seq`, not timestamp: two revisions committed in the same
 * millisecond are common when a model batches a patch, and a tie would make
 * "the last thing" ambiguous.
 */
export function lastTouchedField(instance: FormInstance): string | undefined {
  let best: { field: string; seq: number } | undefined;
  for (const [field, history] of Object.entries(instance.entries)) {
    if (!canUndo(history)) continue;
    const entry = atCursor(history);
    if (!entry) continue;
    if (!best || entry.seq > best.seq) best = { field, seq: entry.seq };
  }
  return best?.field;
}

/** The field holding the earliest revision that a redo could move onto. */
export function nextRedoField(instance: FormInstance): string | undefined {
  let best: { field: string; seq: number } | undefined;
  for (const [field, history] of Object.entries(instance.entries)) {
    const entry = redoTarget(history);
    if (!entry) continue;
    if (!best || entry.seq < best.seq) best = { field, seq: entry.seq };
  }
  return best?.field;
}

/** Apply a commit's appends and cursor move to one field's log. */
export function applyEntryCommit(
  existing: FieldHistory | undefined,
  commit: { append?: FormEntry[]; cursor?: number },
): FieldHistory {
  const revisions = [...(existing?.revisions ?? []), ...(commit.append ?? [])];
  const fallback = commit.append?.length
    ? revisions.length - 1
    : (existing?.cursor ?? -1);
  const cursor = commit.cursor === undefined ? fallback : commit.cursor;
  // A cursor outside the log would strand the field with no readable answer
  // and no way back; clamp rather than trust the caller's arithmetic.
  return { revisions, cursor: Math.max(-1, Math.min(cursor, revisions.length - 1)) };
}

export function cloneHistory(history: FieldHistory): FieldHistory {
  return { revisions: [...history.revisions], cursor: history.cursor };
}
