import type { CompiledField, CompiledForm } from "./compile";
import { evaluateForm, type FormEvaluation } from "./evaluate";
import {
  canRedo,
  canUndo,
  lastTouchedField,
  nextRedoField,
  redoTarget,
  undoTarget,
} from "./history";
import type {
  FormFailure,
  FormFieldView,
  FormInstance,
  FormStepSummary,
  FormView,
  FormViewScope,
} from "./types";

/**
 * Turn evaluated state into the flat field rows the agent reads.
 *
 * This is the lazy-load seam (§4). `scope` is whatever the agent asked for —
 * the open step by default, a named step or the whole outline on request —
 * and nothing outside it is rendered, so a 60-field form costs the same at
 * tier 1 as a 6-field one.
 */
export function projectView<V extends Record<string, unknown>>(
  compiled: CompiledForm<V>,
  instance: FormInstance,
  scope: FormViewScope = { scope: "step" },
  evaluation?: FormEvaluation<V>,
): FormView {
  const ev = evaluation ?? evaluateForm(compiled, instance);

  const base: FormView = {
    instanceId: instance.id,
    defId: compiled.id,
    defVersion: instance.defVersion,
    name: compiled.name,
    status: instance.status,
    conduct: compiled.conduct,
    scope: scope.scope,
    fields: [],
    // A `{ complete: true }` effect finishes the instance regardless of what
    // is still empty, so the flag has to follow the instance and not only the
    // field-by-field evaluation — otherwise the agent reads status "complete"
    // and complete `false` in the same result.
    complete: ev.complete || instance.status === "complete",
    blockedOn: instance.blockedOn,
    waitMessage: instance.blockedOn
      ? compiled.checkpointById.get(instance.blockedOn)?.waitMessage
      : undefined,
  };

  const failures = openFailures(instance);
  if (failures.length > 0) base.failures = failures;
  if (ev.revisiting) base.revisiting = true;

  // What the two reversal verbs would do, named once at the view level. The
  // agent needs to know the move is available and what it would touch; a flag
  // on every field row would cost tokens on every call for a rare verb.
  const undoField = lastTouchedField(instance);
  if (undoField && canUndo(instance.entries[undoField])) {
    base.undo = {
      field: undoField,
      label: compiled.fieldById.get(undoField)?.label ?? undoField,
      becomes: undoTarget(instance.entries[undoField])?.value,
    };
  }
  const redoField = nextRedoField(instance);
  if (redoField && canRedo(instance.entries[redoField])) {
    base.redo = {
      field: redoField,
      label: compiled.fieldById.get(redoField)?.label ?? redoField,
      becomes: redoTarget(instance.entries[redoField])?.value,
    };
  }

  if (scope.scope === "field") {
    const field = compiled.fieldById.get(scope.id);
    if (field) {
      base.fields = [fieldView(field, ev)];
      const step = compiled.stepById.get(field.stepId);
      if (step) {
        base.step = {
          id: step.id,
          title: step.title,
          index: step.index,
          of: compiled.steps.length,
          ask: step.ask,
        };
      }
    }
    return base;
  }

  if (scope.scope === "outline") {
    base.steps = compiled.steps.map((step) => stepSummary(compiled, ev, step.id));
    base.fields = compiled.fields.map((f) => fieldView(f, ev));
    return base;
  }

  // Default: one step in full. Named when the agent asked for a specific one,
  // otherwise whatever is open now — falling back to the last step once every
  // step is complete, so a status call on a finished form shows the answers
  // rather than an empty list.
  const stepId =
    scope.id ?? ev.openStepId ?? compiled.steps[compiled.steps.length - 1]?.id;
  const step = stepId ? compiled.stepById.get(stepId) : undefined;
  if (!step) return base;

  base.step = {
    id: step.id,
    title: step.title,
    index: step.index,
    of: compiled.steps.length,
    ask: step.ask,
  };
  base.fields = step.fieldIds
    .map((id) => compiled.fieldById.get(id))
    .filter((f): f is CompiledField<V> => Boolean(f))
    .map((f) => fieldView(f, ev));
  return base;
}

/**
 * `ask` is the only part of a gate's result that crosses into the agent's
 * view. It is false when the field is already answered, currently
 * inapplicable, or belongs to a step that isn't open — and the agent doesn't
 * need to know which. `status` carries what it does need.
 */
function fieldView(field: CompiledField<any>, ev: FormEvaluation<any>): FormFieldView {
  const fe = ev.fields.get(field.id);
  const status = fe?.status ?? "empty";
  // On a revisit an answered field is still worth asking about — that is the
  // whole point of having been sent back to it. Everywhere else, `filled`
  // means done.
  const answered = status === "filled" && !ev.revisiting;
  const view: FormFieldView = {
    id: field.id,
    label: field.label,
    description: field.description,
    type: field.type,
    required: field.required,
    status,
    ask: Boolean(fe?.applicable) && !answered && field.stepId === ev.openStepId,
  };
  if (status === "filled") view.value = fe?.value;
  else if (status === "held") view.value = fe?.raw;
  if (status === "invalid") view.error = fe?.error;
  return view;
}

export function stepSummary(
  compiled: CompiledForm<any>,
  ev: FormEvaluation<any>,
  stepId: string,
): FormStepSummary {
  const step = compiled.stepById.get(stepId)!;
  let required = 0;
  let filled = 0;
  for (const fieldId of step.fieldIds) {
    const field = compiled.fieldById.get(fieldId);
    const fe = ev.fields.get(fieldId);
    if (!field?.required || !fe?.applicable) continue;
    required++;
    if (fe.valid) filled++;
  }
  return {
    id: step.id,
    title: step.title,
    index: step.index,
    preview: step.preview,
    required,
    filled,
    complete: ev.stepComplete[step.id] ?? false,
    open: ev.stepOpen[step.id] ?? false,
  };
}

/**
 * Tier 0 — the standing line appended to the system prompt each turn.
 *
 * Two things are in it, both deliberate. Pending *labels* for the open step,
 * because "5 fields pending" would force a tool call every turn just to learn
 * what to ask next — costing more than the ~30 tokens it saves. And a
 * one-line `preview` per remaining step, which is what makes opportunistic
 * capture work without loading the whole form: an agent that hears "I already
 * have a lawyer" during step 2 can see representation is coming and grab it.
 *
 * Asks, hints, enum options, validation rules, and every field outside the
 * open step stay out.
 */
export function renderTier0<V extends Record<string, unknown>>(
  compiled: CompiledForm<V>,
  instance: FormInstance,
  evaluation?: FormEvaluation<V>,
): string {
  const tag = `[form: ${compiled.id}]`;

  if (instance.status === "awaiting" && instance.blockedOn) {
    const cp = compiled.checkpointById.get(instance.blockedOn);
    const why = cp?.waitMessage ? ` — ${cp.waitMessage}` : "";
    return `${tag} awaiting "${instance.blockedOn}"${why}`;
  }
  if (instance.status === "stale") {
    return `${tag} stale — the definition changed since this was started; it can't be continued.`;
  }
  if (instance.status === "abandoned") return "";

  const ev = evaluation ?? evaluateForm(compiled, instance);

  // A finished form says nothing — it stays reachable for corrections but
  // doesn't get to occupy the prompt for the rest of the conversation. The
  // exception is a revisit: a trigger sent the conversation back, and going
  // quiet about that is how the jump becomes invisible.
  if (instance.status === "complete" && !ev.revisiting) return "";

  const lines: string[] = [];

  const open = ev.openStepId ? compiled.stepById.get(ev.openStepId) : undefined;
  if (open) {
    const pending = open.fieldIds
      .map((id) => compiled.fieldById.get(id))
      .filter((f): f is CompiledField<V> => {
        if (!f) return false;
        const fe = ev.fields.get(f.id);
        return Boolean(fe?.applicable) && fe?.status !== "filled";
      })
      .map((f) => f.label);
    const head = ev.revisiting
      ? `${tag} back at step ${open.index}/${compiled.steps.length} "${open.title}" — go through it again`
      : `${tag} step ${open.index}/${compiled.steps.length} "${open.title}"`;
    lines.push(pending.length > 0 ? `${head} · pending: ${pending.join(", ")}` : head);
  } else {
    lines.push(`${tag} nothing pending`);
  }

  const later = compiled.steps
    .filter((s) => (!open || s.index > open.index) && !ev.stepComplete[s.id])
    .map((s) => (s.preview ? `${s.title} (${s.preview})` : s.title));
  if (later.length > 0) lines.push(`later: ${later.join(" · ")}`);

  const failures = openFailures(instance);
  for (const failure of failures) {
    lines.push(`blocked earlier: ${failure.hookId} — ${failure.message}`);
  }

  if (compiled.conduct) lines.push(compiled.conduct);

  return lines.join("\n");
}

/**
 * Blocking-checkpoint rejections. Recorded rather than thrown, because a
 * `fail` unblocks the instance and hands the agent something to act on.
 */
export function openFailures(instance: FormInstance): FormFailure[] {
  const out: FormFailure[] = [];
  for (const state of Object.values(instance.dispatches ?? {})) {
    if (state.status !== "failed" || !state.error) continue;
    out.push({ hookId: state.hookId, message: state.error, at: state.at });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}
