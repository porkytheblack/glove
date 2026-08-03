import type { DisplayManagerAdapter } from "glove-core";
import {
  FormBlockedError,
  FormConflictError,
  FormDefinitionError,
  FormError,
  FormStaleError,
  MemoryNotFoundError,
} from "../core/errors";
import type { Provenance } from "../core/provenance";
import type { FormAdapter } from "./adapter";
import { createFormMemoryBridge, type FormMemoryAdapters } from "./bridge";
import type { CompiledForm } from "./compile";
import { evaluateForm, formatZodError, type FormEvaluation } from "./evaluate";
import { openFailures, projectView, renderTier0 } from "./project";
import type { FormListing, FormRegistry } from "./registry";
import type {
  FormEffect,
  FormEntry,
  FormExecutor,
  FormFailure,
  FormFieldIssue,
  FormInstance,
  FormInstanceCommit,
  FormView,
  FormViewScope,
} from "./types";

/**
 * How many times a patch-producing executor may re-enter the commit cycle
 * before the runner stops. A `{ patch }` commits like any other write, so it
 * re-runs the gates and can fire more hooks — which can patch again. Eight is
 * far past anything legitimate and short of a wedged process.
 */
const MAX_DISPATCH_ROUNDS = 8;

/** Optimistic-concurrency retries before a commit gives up. */
const MAX_COMMIT_RETRIES = 3;

export interface FormRunnerOptions {
  registry: FormRegistry;
  /** Conversation id / user id / matter id. A thunk when it varies per turn. */
  subject: string | (() => string);
  /** Wired into `ctx.memory`. Anything omitted throws if an executor reaches for it. */
  memory?: FormMemoryAdapters;
  display?: DisplayManagerAdapter;
  /** Provenance defaults for writes the runner makes on the agent's behalf. */
  actor?: string;
  source?: string;
}

export interface FormCallOpts {
  instanceId?: string;
  subject?: string;
  provenance?: Provenance;
  signal?: AbortSignal;
}

export interface FormFillResult {
  view: FormView;
  /** Field ids written and now live. */
  captured: string[];
  /** Field ids written but not applicable right now — kept, don't count. */
  held: string[];
  /** Ids the def doesn't declare. Ignored, reported. */
  unknown: string[];
  /** One row per `ZodIssue`. The model can act on these without a round trip. */
  issues: FormFieldIssue[];
  /** Blocking-checkpoint rejections raised by this write. */
  failures: FormFailure[];
}

interface Hook {
  hookId: string;
  kind: "field" | "step" | "checkpoint" | "form";
  id: string;
  blocking: boolean;
  run: FormExecutor<any>;
  occurrence: number;
}

/**
 * The engine. Owns the commit-then-run cycle, rising-edge detection, the
 * dispatch log, and def-drift handling.
 *
 * The one rule that shapes everything: **writes are never gated.** Any value
 * the agent can derive, at any point in the conversation, is accepted — the
 * only thing that can reject a write is zod. Sequence controls what the agent
 * should be steering toward, not what the engine will store, so there is no
 * lock, no locked-field error, and no path through `fill` that refuses a
 * well-typed value because it arrived early.
 */
export class FormRunner {
  readonly adapter: FormAdapter;
  readonly registry: FormRegistry;
  private readonly options: FormRunnerOptions;

  constructor(adapter: FormAdapter, options: FormRunnerOptions) {
    this.adapter = adapter;
    this.registry = options.registry;
    this.options = options;
  }

  subject(override?: string): string {
    if (override) return override;
    const s = this.options.subject;
    return typeof s === "function" ? s() : s;
  }

  // ─── Read ───────────────────────────────────────────────────────────────

  /** Registration data only — no module load, no compile. */
  list(): FormListing[] {
    return this.registry.list();
  }

  /** The instance the conversation is on: newest `active` or `awaiting`. */
  async activeInstance(subject?: string): Promise<FormInstance | null> {
    const found = await this.adapter.findInstances({
      subject: this.subject(subject),
      limit: 25,
    });
    const open = found.filter(
      (i) => i.status === "active" || i.status === "awaiting" || i.status === "stale",
    );
    open.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return open[0] ?? null;
  }

  async status(opts: FormCallOpts = {}): Promise<FormView> {
    const { compiled, instance } = await this.resolve(opts);
    return projectView(compiled, instance, { scope: "step" });
  }

  async inspect(scope: FormViewScope, opts: FormCallOpts = {}): Promise<FormView> {
    const { compiled, instance } = await this.resolve(opts);
    return projectView(compiled, instance, scope);
  }

  /** The standing one-line notification. Empty string when nothing is open. */
  async tier0(subject?: string): Promise<string> {
    const instance = await this.activeInstance(subject);
    if (!instance) return "";
    let compiled: CompiledForm<any>;
    try {
      compiled = await this.registry.load(instance.defId);
    } catch {
      return "";
    }
    if (instance.defVersion !== compiled.version && !compiled.migrate) {
      return renderTier0(compiled, { ...instance, status: "stale" });
    }
    return renderTier0(compiled, instance);
  }

  // ─── Write ──────────────────────────────────────────────────────────────

  async start(
    defId: string,
    opts: FormCallOpts & { seed?: Record<string, unknown> } = {},
  ): Promise<FormFillResult> {
    const compiled = await this.registry.load(defId);
    const provenance = this.provenance(opts.provenance);
    const created = await this.adapter.createInstance(
      {
        defId,
        defVersion: compiled.version,
        subject: this.subject(opts.subject),
        status: "active",
      },
      provenance,
    );

    const seed = opts.seed ?? {};
    const { entries, issues, unknown } = this.stage(compiled, seed, provenance);
    // `fromScratch` — a fresh instance has no prior evaluation, so everything
    // true right now is a rising edge. A checkpoint gated on `() => true`
    // fires at start rather than waiting for the first answer.
    const settled = await this.applyEntries(compiled, created, entries, provenance, {
      signal: opts.signal,
      fromScratch: true,
    });
    return this.fillResult(compiled, settled.instance, entries, issues, unknown, settled.failures);
  }

  /**
   * Write a patch of any field ids at once — not just the open step's.
   *
   * Each value is validated independently, so one bad answer doesn't reject
   * the rest, and a value that isn't applicable right now is kept as a held
   * entry rather than dropped. Opportunistic derivation therefore costs
   * nothing extra: capture what you heard, whatever step it belonged to.
   */
  async fill(
    values: Record<string, unknown>,
    opts: FormCallOpts = {},
  ): Promise<FormFillResult> {
    const { compiled, instance } = await this.resolve(opts);
    this.assertWritable(instance);
    const provenance = this.provenance(opts.provenance);
    const { entries, issues, unknown } = this.stage(compiled, values, provenance);
    const settled = await this.applyEntries(compiled, instance, entries, provenance, {
      signal: opts.signal,
    });
    return this.fillResult(compiled, settled.instance, entries, issues, unknown, settled.failures);
  }

  /**
   * Amend an earlier answer. Mechanically the same write as `fill` — there is
   * no separate revision path, because nothing was locked in the first place.
   * The distinct entry point exists so the reason lands in provenance and so
   * the model has an obvious verb for "they just corrected themselves".
   */
  async revise(
    field: string,
    value: unknown,
    opts: FormCallOpts & { reason?: string } = {},
  ): Promise<FormFillResult> {
    const provenance = this.provenance(opts.provenance);
    return this.fill(
      { [field]: value },
      {
        ...opts,
        provenance: {
          ...provenance,
          note: opts.reason ? `revision: ${opts.reason}` : "revision",
        },
      },
    );
  }

  async abandon(reason: string, opts: FormCallOpts = {}): Promise<FormInstance> {
    const { instance } = await this.resolve({ ...opts, allowStale: true });
    const provenance = this.provenance(opts.provenance);
    return this.adapter.commitInstance(
      instance.id,
      { status: "abandoned", closedReason: reason, blockedOn: null },
      { ifVersion: instance.version },
      provenance,
    );
  }

  /**
   * Unblock an instance parked on a blocking checkpoint, from outside the
   * executor that parked it — a mesh reply, a host callback, or a process
   * that restarted while `awaiting`.
   */
  async resolveCheckpoint(
    checkpointId: string,
    outcome: { ok: boolean; values?: Record<string, unknown>; error?: string },
    opts: FormCallOpts = {},
  ): Promise<FormFillResult> {
    const { compiled, instance } = await this.resolve(opts);
    const provenance = this.provenance(opts.provenance);
    const resolved = await this.adapter.resolveCheckpoint(
      instance.id,
      checkpointId,
      outcome,
      provenance,
    );
    const { entries, issues, unknown } = this.stage(
      compiled,
      outcome.values ?? {},
      provenance,
    );
    const settled = await this.applyEntries(compiled, resolved, entries, provenance, {
      signal: opts.signal,
    });
    return this.fillResult(compiled, settled.instance, entries, issues, unknown, settled.failures);
  }

  // ─── Resolution and drift ───────────────────────────────────────────────

  /**
   * Find the instance a call is about and reconcile it against the registered
   * def.
   *
   * §5.2 — when a live instance's `defVersion` doesn't match, the runner does
   * not guess. A def that supplies `migrate` gets to carry values forward;
   * everything else goes `stale` with the reason surfaced, because silently
   * re-interpreting old answers under new schemas is the failure mode worth
   * being loud about.
   */
  async resolve(
    opts: FormCallOpts & { allowStale?: boolean } = {},
  ): Promise<{ compiled: CompiledForm<any>; instance: FormInstance }> {
    const instance = opts.instanceId
      ? await this.adapter.getInstance(opts.instanceId)
      : await this.activeInstance(opts.subject);
    if (!instance) {
      throw new MemoryNotFoundError(
        opts.instanceId
          ? `No form instance "${opts.instanceId}".`
          : `No open form instance for subject "${this.subject(opts.subject)}".`,
      );
    }

    const compiled = await this.registry.load(instance.defId);
    if (instance.defVersion === compiled.version) return { compiled, instance };

    if (!compiled.migrate) {
      const staled =
        instance.status === "stale"
          ? instance
          : await this.adapter.commitInstance(
              instance.id,
              { status: "stale" },
              { ifVersion: instance.version },
              this.provenance(opts.provenance, `def drift ${instance.defVersion} → ${compiled.version}`),
            );
      if (opts.allowStale) return { compiled, instance: staled };
      throw new FormStaleError(instance.defVersion, compiled.version);
    }

    const provenance = this.provenance(
      opts.provenance,
      `migrated ${instance.defVersion} → ${compiled.version}`,
    );
    const carried = compiled.migrate(rawValues(instance), instance.defVersion);
    const entries: Record<string, FormEntry> = {};
    for (const [id, value] of Object.entries(carried ?? {})) {
      if (!compiled.fieldById.has(id)) continue;
      entries[id] = this.entry(compiled, id, value, provenance);
    }
    const migrated = await this.adapter.commitInstance(
      instance.id,
      {
        entries,
        defVersion: compiled.version,
        status: instance.status === "stale" ? "active" : instance.status,
      },
      { ifVersion: instance.version },
      provenance,
    );
    return { compiled, instance: migrated };
  }

  // ─── Commit and dispatch ────────────────────────────────────────────────

  /**
   * Commit values and the rising-edge log in one atomic write, then run the
   * executors that edge implies.
   *
   * Commit-then-run is what makes at-least-once dispatch safe: the answer is
   * durable before any executor sees it, so a crash mid-executor replays the
   * hook under the same idempotency key rather than losing the answer.
   */
  private async applyEntries(
    compiled: CompiledForm<any>,
    instance: FormInstance,
    newEntries: Record<string, FormEntry>,
    provenance: Provenance,
    opts: { signal?: AbortSignal; fromScratch?: boolean; round?: number },
  ): Promise<{ instance: FormInstance; failures: FormFailure[] }> {
    const round = opts.round ?? 0;
    let current = instance;
    let committed: FormInstance | undefined;
    let hooks: Hook[] = [];
    let after: FormEvaluation<any> | undefined;

    for (let attempt = 0; ; attempt++) {
      const before = opts.fromScratch
        ? emptyEvaluation()
        : evaluateForm(compiled, current);
      const projected: FormInstance = {
        ...current,
        entries: { ...current.entries, ...newEntries },
      };
      after = evaluateForm(compiled, projected);
      assertNoDefects(compiled, after);

      const edges = risingEdges(compiled, before, after, current.occurrences);
      hooks = edges.hooks;

      const blocking = hooks.find((h) => h.kind === "checkpoint" && h.blocking);
      const commit: FormInstanceCommit = {
        entries: newEntries,
        occurrences: edges.occurrences,
      };
      if (blocking) {
        commit.status = "awaiting";
        commit.blockedOn = blocking.id;
      } else if (after.complete && current.status !== "complete") {
        commit.status = "complete";
        commit.completedAt = provenance.timestamp;
      } else if (current.status === "awaiting" && !current.blockedOn) {
        commit.status = "active";
      } else if (current.status === "complete" && !after.complete) {
        // A revision that reopened the form.
        commit.status = "active";
      }

      try {
        committed = await this.adapter.commitInstance(
          current.id,
          commit,
          { ifVersion: current.version },
          provenance,
        );
        break;
      } catch (e) {
        if (!(e instanceof FormConflictError) || attempt >= MAX_COMMIT_RETRIES) throw e;
        const reloaded = await this.adapter.getInstance(current.id);
        if (!reloaded) throw e;
        current = reloaded;
      }
    }

    const outcome = await this.runHooks(
      committed!,
      hooks,
      after!,
      provenance,
      opts.signal,
    );

    let settled = outcome.instance;
    const failures = outcome.failures;

    // Post-hook status: unblock, honour `jump` / `complete`, or fall back to
    // whatever the values now say.
    const post = evaluateForm(compiled, settled);
    const closing: FormInstanceCommit = {};
    if (settled.blockedOn) closing.blockedOn = null;
    if (outcome.jump && compiled.stepById.has(outcome.jump)) {
      closing.openStepOverride = outcome.jump;
    }
    const shouldComplete = outcome.forceComplete || post.complete;
    const nextStatus = shouldComplete ? "complete" : "active";
    if (settled.status !== nextStatus && settled.status !== "abandoned") {
      closing.status = nextStatus;
      if (nextStatus === "complete" && !settled.completedAt) {
        closing.completedAt = new Date().toISOString();
      }
    }
    if (Object.keys(closing).length > 0) {
      settled = await this.commitTolerant(settled, closing, provenance);
    }

    // A patch is an ordinary write: it commits, re-runs the gates, and can
    // fire more hooks. Bounded, so a patch loop stops rather than spins.
    const patchEntries: Record<string, FormEntry> = {};
    for (const [id, value] of Object.entries(outcome.patch)) {
      if (!compiled.fieldById.has(id)) continue;
      patchEntries[id] = this.entry(compiled, id, value, provenance);
    }
    if (Object.keys(patchEntries).length > 0 && round < MAX_DISPATCH_ROUNDS) {
      const next = await this.applyEntries(compiled, settled, patchEntries, provenance, {
        signal: opts.signal,
        round: round + 1,
      });
      return { instance: next.instance, failures: [...failures, ...next.failures] };
    }

    return { instance: settled, failures };
  }

  private async runHooks(
    instance: FormInstance,
    hooks: Hook[],
    evaluation: FormEvaluation<any>,
    provenance: Provenance,
    signal?: AbortSignal,
  ): Promise<{
    instance: FormInstance;
    failures: FormFailure[];
    patch: Record<string, unknown>;
    jump?: string;
    forceComplete: boolean;
  }> {
    const failures: FormFailure[] = [];
    const patch: Record<string, unknown> = {};
    let jump: string | undefined;
    let forceComplete = false;
    let current = instance;

    for (const hook of hooks) {
      const idempotencyKey = `${instance.id}:${hook.hookId}:${hook.occurrence}`;
      if (current.dispatches?.[idempotencyKey]?.status === "ok") continue;

      const attempts = (current.dispatches?.[idempotencyKey]?.attempts ?? 0) + 1;
      const at = new Date().toISOString();
      await this.adapter.recordDispatch(
        current.id,
        idempotencyKey,
        { hookId: hook.hookId, status: "running", attempts, at },
        provenance,
      );

      let effect: FormEffect<any> | void = undefined;
      let error: string | undefined;
      try {
        effect = await hook.run({
          values: evaluation.values,
          instance: current,
          hookId: hook.hookId,
          idempotencyKey,
          memory: createFormMemoryBridge(this.options.memory ?? {}, provenance),
          display: this.options.display,
          signal,
        });
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }

      if (!error && effect && "fail" in effect) error = effect.fail;

      if (error) {
        failures.push({ hookId: hook.hookId, message: error, at });
      } else if (effect) {
        if ("patch" in effect) Object.assign(patch, effect.patch);
        else if ("jump" in effect) jump = effect.jump;
        else if ("complete" in effect) forceComplete = true;
      }

      await this.adapter.recordDispatch(
        current.id,
        idempotencyKey,
        {
          hookId: hook.hookId,
          status: error ? "failed" : "ok",
          attempts,
          at: new Date().toISOString(),
          error,
        },
        provenance,
      );
      const reloaded = await this.adapter.getInstance(current.id);
      if (reloaded) current = reloaded;
    }

    return { instance: current, failures, patch, jump, forceComplete };
  }

  /** A closing status write must not lose the hook results to a conflict. */
  private async commitTolerant(
    instance: FormInstance,
    commit: FormInstanceCommit,
    provenance: Provenance,
  ): Promise<FormInstance> {
    let current = instance;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.adapter.commitInstance(
          current.id,
          commit,
          { ifVersion: current.version },
          provenance,
        );
      } catch (e) {
        if (!(e instanceof FormConflictError) || attempt >= MAX_COMMIT_RETRIES) throw e;
        const reloaded = await this.adapter.getInstance(current.id);
        if (!reloaded) throw e;
        current = reloaded;
      }
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  /**
   * Validate a patch field by field. Nothing is rejected outright: an entry
   * that fails its schema is still stored, carrying the error, so the answer
   * the user actually gave stays visible and the field shows as `invalid`
   * rather than reverting to `empty`.
   */
  private stage(
    compiled: CompiledForm<any>,
    values: Record<string, unknown>,
    provenance: Provenance,
  ): {
    entries: Record<string, FormEntry>;
    issues: FormFieldIssue[];
    unknown: string[];
  } {
    const entries: Record<string, FormEntry> = {};
    const issues: FormFieldIssue[] = [];
    const unknown: string[] = [];

    for (const [id, value] of Object.entries(values)) {
      const field = compiled.fieldById.get(id);
      if (!field) {
        unknown.push(id);
        continue;
      }
      const parsed = field.schema.safeParse(value);
      entries[id] = {
        value,
        at: provenance.timestamp,
        provenance,
        error: parsed.success ? undefined : formatZodError(parsed.error),
      };
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          issues.push({
            field: id,
            message: issue.message,
            hint: field.description ?? `Expected ${field.type}.`,
          });
        }
      }
    }
    return { entries, issues, unknown };
  }

  private entry(
    compiled: CompiledForm<any>,
    id: string,
    value: unknown,
    provenance: Provenance,
  ): FormEntry {
    const field = compiled.fieldById.get(id)!;
    const parsed = field.schema.safeParse(value);
    return {
      value,
      at: provenance.timestamp,
      provenance,
      error: parsed.success ? undefined : formatZodError(parsed.error),
    };
  }

  private fillResult(
    compiled: CompiledForm<any>,
    instance: FormInstance,
    written: Record<string, FormEntry>,
    issues: FormFieldIssue[],
    unknown: string[],
    failures: FormFailure[],
  ): FormFillResult {
    const ev = evaluateForm(compiled, instance);
    const captured: string[] = [];
    const held: string[] = [];
    for (const id of Object.keys(written)) {
      const fe = ev.fields.get(id);
      if (!fe) continue;
      if (fe.status === "held") held.push(id);
      else if (fe.status === "filled") captured.push(id);
    }
    return {
      view: projectView(compiled, instance, { scope: "step" }, ev),
      captured,
      held,
      unknown,
      issues,
      failures: failures.length > 0 ? failures : openFailures(instance),
    };
  }

  private assertWritable(instance: FormInstance): void {
    if (instance.status === "abandoned") {
      throw new FormError(
        "form_validation_failed",
        `Form instance "${instance.id}" was abandoned and no longer accepts answers.`,
      );
    }
    if (instance.status === "awaiting" && instance.blockedOn) {
      const cp = instance.blockedOn;
      throw new FormBlockedError(cp);
    }
  }

  private provenance(supplied?: Provenance, note?: string): Provenance {
    const now = new Date().toISOString();
    return {
      source: supplied?.source ?? this.options.source ?? "forms",
      actor: supplied?.actor ?? this.options.actor ?? "agent",
      timestamp: supplied?.timestamp ?? now,
      note: note ?? supplied?.note,
    };
  }
}

// ─── Rising edges ─────────────────────────────────────────────────────────

/**
 * Hooks fire on every rising edge, and every edge bumps a per-hook counter
 * whether or not an executor is attached — the counter is the third segment
 * of the idempotency key, so a retry reuses the key and a genuine second
 * crossing gets a fresh one.
 *
 * An entry crossing *into* live fires `onFill`; an entry crossing *out* fires
 * nothing. "Live" here means applicable and valid, so fixing a rejected
 * answer is a crossing but re-stating an accepted one is not.
 *
 * Whether a repeat firing is real work or a no-op is the executor's call, not
 * the engine's: dispatch is at-least-once and does not attempt compensation.
 */
function risingEdges(
  compiled: CompiledForm<any>,
  before: FormEvaluation<any>,
  after: FormEvaluation<any>,
  occurrences: Record<string, number>,
): { hooks: Hook[]; occurrences: Record<string, number> } {
  const next = { ...occurrences };
  const hooks: Hook[] = [];

  const bump = (hookId: string): number => {
    const value = (next[hookId] ?? 0) + 1;
    next[hookId] = value;
    return value;
  };

  for (const field of compiled.fields) {
    if (!after.live.has(field.id) || before.live.has(field.id)) continue;
    const occurrence = bump(`field:${field.id}`);
    if (field.onFill) {
      hooks.push({
        hookId: `field:${field.id}`,
        kind: "field",
        id: field.id,
        blocking: false,
        run: field.onFill,
        occurrence,
      });
    }
  }

  for (const step of compiled.steps) {
    if (!after.stepComplete[step.id] || before.stepComplete[step.id]) continue;
    const occurrence = bump(`step:${step.id}`);
    if (step.onComplete) {
      hooks.push({
        hookId: `step:${step.id}`,
        kind: "step",
        id: step.id,
        blocking: false,
        run: step.onComplete,
        occurrence,
      });
    }
  }

  for (const cp of compiled.checkpoints) {
    if (!after.checkpointActive[cp.id] || before.checkpointActive[cp.id]) continue;
    const occurrence = bump(`checkpoint:${cp.id}`);
    hooks.push({
      hookId: `checkpoint:${cp.id}`,
      kind: "checkpoint",
      id: cp.id,
      blocking: cp.blocking,
      run: cp.run,
      occurrence,
    });
  }

  if (after.complete && !before.complete) {
    const occurrence = bump("form");
    if (compiled.onComplete) {
      hooks.push({
        hookId: "form",
        kind: "form",
        id: compiled.id,
        blocking: false,
        run: compiled.onComplete,
        occurrence,
      });
    }
  }

  return { hooks, occurrences: next };
}

function emptyEvaluation(): FormEvaluation<any> {
  return {
    values: {},
    held: {},
    fields: new Map(),
    live: new Set(),
    stepComplete: {},
    stepOpen: {},
    openStepId: undefined,
    complete: false,
    checkpointActive: {},
    passes: 0,
    defects: [],
  };
}

function assertNoDefects(compiled: CompiledForm<any>, ev: FormEvaluation<any>): void {
  if (ev.defects.length === 0) return;
  throw new FormDefinitionError(
    `Form "${compiled.id}" cannot be evaluated: ${ev.defects.join("; ")}.`,
    ev.defects,
  );
}

function rawValues(instance: FormInstance): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [id, entry] of Object.entries(instance.entries)) out[id] = entry.value;
  return out;
}
