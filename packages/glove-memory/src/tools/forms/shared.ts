import type { ToolResultData } from "glove-core";
import { MemoryError } from "../../core/errors";
import { ProvenanceSchema } from "../../core/provenance";
import type { FormFillResult, FormRunner } from "../../forms";
import type { FormView } from "../../forms/types";

export const ProvenanceArgSchema = ProvenanceSchema;

export function errorResult(e: unknown): ToolResultData {
  if (e instanceof MemoryError) {
    return { status: "error", message: e.message, data: { code: e.code } };
  }
  const message = e instanceof Error ? e.message : String(e);
  return { status: "error", message, data: null };
}

/**
 * The view, trimmed to what's worth spending tokens on. `undefined` keys are
 * dropped rather than serialised as nulls — a 20-field step shouldn't carry
 * 40 empty properties into the context window.
 */
export function renderView(view: FormView): Record<string, unknown> {
  const out: Record<string, unknown> = {
    instance_id: view.instanceId,
    form: view.defId,
    name: view.name,
    status: view.status,
    complete: view.complete,
    fields: view.fields.map((f) => {
      const row: Record<string, unknown> = {
        id: f.id,
        label: f.label,
        type: f.type,
        required: f.required,
        status: f.status,
        ask: f.ask,
      };
      if (f.description) row.description = f.description;
      if (f.value !== undefined) row.value = f.value;
      if (f.error) row.error = f.error;
      return row;
    }),
  };
  if (view.step) {
    out.step = {
      id: view.step.id,
      title: view.step.title,
      position: `${view.step.index}/${view.step.of}`,
      ...(view.step.ask ? { ask: view.step.ask } : {}),
    };
  }
  if (view.steps) {
    out.steps = view.steps.map((s) => ({
      id: s.id,
      title: s.title,
      position: `${s.index}/${view.steps!.length}`,
      ...(s.preview ? { collects: s.preview } : {}),
      progress: `${s.filled}/${s.required}`,
      complete: s.complete,
      open: s.open,
    }));
  }
  if (view.blockedOn) {
    out.blocked_on = view.blockedOn;
    if (view.waitMessage) out.waiting = view.waitMessage;
  }
  if (view.failures?.length) {
    out.failures = view.failures.map((f) => ({ hook: f.hookId, message: f.message }));
  }
  if (view.undo) {
    out.undo_would = `${view.undo.field}${
      view.undo.becomes === undefined ? " → empty" : ` → ${JSON.stringify(view.undo.becomes)}`
    }`;
  }
  if (view.redo) {
    out.redo_would = `${view.redo.field}${
      view.redo.becomes === undefined ? " → empty" : ` → ${JSON.stringify(view.redo.becomes)}`
    }`;
  }
  if (view.closedReason) {
    out.closed_reason = view.closedReason;
    out.closed_note =
      "Collection stopped — don't keep asking for the remaining fields. Tell the user why.";
  }
  if (view.conduct) out.conduct = view.conduct;
  return out;
}

export function renderFillResult(result: FormFillResult): Record<string, unknown> {
  const out = renderView(result.view);
  if (result.captured.length > 0) out.captured = result.captured;
  if (result.held.length > 0) {
    out.held = result.held;
    out.held_note =
      "Kept, but not applicable given the current answers — they don't count toward completion and will come back if the answers change.";
  }
  if (result.aliased.length > 0) {
    out.renamed = result.aliased.map((a) => `${a.sent} → ${a.resolved}`);
  }
  if (result.unknown.length > 0) {
    out.unknown_fields = result.unknown.map((u) =>
      u.didYouMean.length > 0
        ? { field: u.field, did_you_mean: u.didYouMean }
        : { field: u.field },
    );
    out.unknown_note =
      "These aren't fields on this form, so nothing was stored for them. Use `did_you_mean` " +
      "where it's offered, or call glove_form_inspect to see the real ids — don't guess again.";
  }
  if (result.issues.length > 0) {
    out.rejected = result.issues.map((i) => ({
      field: i.field,
      message: i.message,
      ...(i.hint ? { hint: i.hint } : {}),
    }));
  }
  return out;
}

/** Every tool takes an optional instance id; omitting it means "the open one". */
export const INSTANCE_ID_DESCRIPTION =
  "Instance id. Omit to use the form currently open in this conversation — normally you should omit it.";

export type RunnerFactory = FormRunner | (() => FormRunner);

export function resolveRunner(runner: RunnerFactory): FormRunner {
  return typeof runner === "function" ? runner() : runner;
}
