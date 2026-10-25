import type { IGloveRunnable, Message } from "glove-core";
import {
  compileForm,
  evaluateForm,
  type CompiledForm,
  type FormDef,
  type FormEffect,
  type FormExecutor,
  type FormExecutorContext,
  type FormInstance,
  type FormRunner,
} from "glove-memory/forms";
import { renderPlan, type BranchSpec, type Candidate, type NextBestPlanner, type Plan, type Turn } from "./planner";

/** What the planner needs to know about a form beyond its definition. */
export interface FormPlanConfig {
  /** The enum field that picks a branch, and a statement per label the classifier judges. */
  branch?: { field: string; labels: Record<string, string>; instructions?: string };
  /** Field id → statements that are true once the speaker has given it (see `Candidate.covered`). */
  covered?: Record<string, string | string[]>;
  /** Step id → a statement that is true of a message about that step. */
  groups?: Record<string, string>;
}

/**
 * Every field still worth asking about, across all steps.
 *
 * Tier 0 shows only the open step's pending fields; the planner needs all of
 * them so it can pull a later question forward. Branch fields that aren't
 * applicable yet are included when they *would* be under some branch: each
 * branch label is tried as a hypothetical answer and the form re-evaluated.
 * Gates are pure by contract, so probing them is safe.
 */
export function formCandidates(
  compiled: CompiledForm<any>,
  instance: FormInstance,
  config: FormPlanConfig,
): { candidates: Candidate[]; branch?: BranchSpec } {
  const ev = evaluateForm(compiled, instance);
  const discriminator = config.branch?.field;
  const known = discriminator && ev.live.has(discriminator) ? String(ev.values[discriminator]) : undefined;
  const probes = config.branch && !known
    ? Object.keys(config.branch.labels).map((label) => ({ label, ev: evaluateForm(compiled, withAnswer(instance, config.branch!.field, label)) }))
    : [];

  const candidates: Candidate[] = [];
  for (const field of compiled.fields) {
    const fe = ev.fields.get(field.id);
    if (fe?.status === "filled" || fe?.status === "skipped" || fe?.status === "held") continue;
    let appliesTo: string[] | undefined;
    if (!fe?.applicable) {
      if (probes.length === 0) continue;
      appliesTo = probes.filter((p) => p.ev.fields.get(field.id)?.applicable).map((p) => p.label);
      if (appliesTo.length === 0) continue;
    }
    candidates.push({
      id: field.id,
      label: field.label,
      group: field.stepId,
      prior: (1 - field.order / compiled.fields.length) * (field.required ? 1 : 0.5),
      covered: config.covered?.[field.id] ?? (field.id === discriminator ? undefined : `The speaker gives their ${field.label.toLowerCase()}.`),
      ...(appliesTo ? { appliesTo } : {}),
      ...(field.id === discriminator ? { decidesBranch: true } : {}),
    });
  }
  return {
    candidates,
    ...(config.branch ? { branch: { labels: config.branch.labels, instructions: config.branch.instructions, known } } : {}),
  };
}

/** Step id → focus statement, defaulting to the step's title and preview. */
export function formGroups(compiled: CompiledForm<any>, config: FormPlanConfig): Record<string, string> {
  return Object.fromEntries(compiled.steps.map((s) => [
    s.id,
    config.groups?.[s.id] ?? `The speaker is talking about ${s.title.toLowerCase()}${s.preview ? ` (${s.preview})` : ""}.`,
  ]));
}

export async function planForm(
  planner: NextBestPlanner,
  compiled: CompiledForm<any>,
  instance: FormInstance,
  config: FormPlanConfig,
  turns: Turn[],
  signal?: AbortSignal,
): Promise<Plan> {
  return planner.plan({ ...formCandidates(compiled, instance, config), turns, groups: formGroups(compiled, config) }, signal);
}

/** The speaker's own messages: no tool results, runtime snapshots, skill injections or summaries. */
export function speakerTurns(messages: Message[]): Turn[] {
  return messages.flatMap((m, i) =>
    m.sender === "user" && !m.framework_context && !m.is_skill_injection && !m.is_compaction && !m.is_compaction_request &&
    !m.tool_results?.length && m.text.trim()
      ? [{ id: m.id ?? `m${i}`, text: m.text }]
      : [],
  );
}

// ─── Advisory: one more runtime-context line ─────────────────────────────

/**
 * Append the plan after the form's tier-0 line before each model iteration.
 *
 * The agent keeps every decision; it just reads which question is worth
 * asking now. The plan is cached per (answers, latest speaker turn),
 * so the iterations after tool results within one turn reuse it rather than
 * classifying again.
 */
export function useNextBestForm(
  glove: IGloveRunnable,
  options: { runner: FormRunner; planner: NextBestPlanner; config: FormPlanConfig },
): () => void {
  let cached: { key: string; line: string } | undefined;
  return glove.addContextProvider(async (signal) => {
    const instance = await options.runner.activeInstance();
    if (!instance || instance.status !== "active") return "";
    const compiled = await options.runner.registry.load(instance.defId);
    const turns = speakerTurns(await glove.store.getMessages());
    const key = `${answersKey(instance)}:${turns.at(-1)?.id ?? ""}`;
    if (cached?.key === key) return cached.line;
    const plan = await planForm(options.planner, compiled, instance, options.config, turns, signal);
    cached = { key, line: renderPlan(plan, { tag: `next-best: ${compiled.id}` }) };
    return cached.line;
  });
}

// ─── Authoritative: steer the open step with { jump } ────────────────────

/**
 * Let the plan move the form's open step.
 *
 * The engine derives the open step (first incomplete step whose gate holds)
 * and only an executor's `{ jump }` overrides it, so routing has to live in
 * executors: every field's `onFill` and `onSkip`, plus a checkpoint that fires
 * at start. Each asks the planner and jumps to the step of the best question
 * when that step has something to ask now and isn't already open.
 *
 * Executors don't see the conversation, so the host passes `turns`.
 */
export function withNextBestRouting<V extends Record<string, unknown>>(
  def: FormDef<V>,
  options: { planner: NextBestPlanner; config: FormPlanConfig; turns: () => Turn[]; onRoute?: (route: RouteDecision) => void },
): FormDef<V> {
  const compiled = compileForm(def);
  // Several hooks fire per commit (one per filled field). Decide once per state.
  let last: { key: string; jump?: string } | undefined;
  const route = async (ctx: FormExecutorContext<V>): Promise<FormEffect<V> | void> => {
    const turns = options.turns();
    const key = `${answersKey(ctx.instance)}:${turns.at(-1)?.id ?? ""}`;
    if (last?.key === key) return last.jump ? { jump: last.jump } : undefined;
    const plan = await planForm(options.planner, compiled, ctx.instance, options.config, turns, ctx.signal);
    const decision = decideJump(compiled, ctx.instance, plan);
    last = { key, jump: decision.jump };
    options.onRoute?.(decision);
    return decision.jump ? { jump: decision.jump } : undefined;
  };
  const wrap = <C extends FormExecutorContext<V>>(own?: (ctx: C) => ReturnType<FormExecutor<V>>) => async (ctx: C) => {
    const effects = await own?.(ctx);
    const jump = await route(ctx);
    return [...asArray(effects), ...(jump ? [jump] : [])];
  };
  return {
    ...def,
    steps: def.steps.map((step) => ({
      ...step,
      fields: step.fields.map((field) => ({ ...field, onFill: wrap(field.onFill), onSkip: wrap(field.onSkip) })),
    })),
    checkpoints: [...def.checkpoints, { id: "next-best:start", when: () => true, blocking: false, run: (ctx) => route(ctx) }],
  };
}

export interface RouteDecision {
  plan: Plan;
  /** The step the form was on. */
  from?: string;
  /** Where it was sent, when it was moved. */
  jump?: string;
  reason: string;
}

/**
 * Jump to the step of the best question, but only to a step that can ask it.
 *
 * A branch step before the branch is answered has no applicable fields, so
 * the engine counts it complete, and jumping there would be a *revisit* of an
 * empty step. When the best question belongs to a branch that isn't settled
 * yet, steer to the question that settles it instead; the branch questions
 * stay in the advisory line until then.
 */
export function decideJump(compiled: CompiledForm<any>, instance: FormInstance, plan: Plan): RouteDecision {
  const ev = evaluateForm(compiled, instance);
  const from = ev.openStepId;
  const top = plan.ask[0]?.candidate;
  const decider = [...plan.confirm, ...plan.ask].find((m) => m.candidate.decidesBranch)?.candidate;
  const target = top?.appliesTo && decider
    ? decider
    : plan.ask.find((m) => !m.candidate.appliesTo && m.candidate.group && !ev.stepComplete[m.candidate.group])?.candidate;
  if (!target?.group) return { plan, from, reason: "nothing to ask" };
  const why = target === decider && top !== decider ? `"${top!.label}" waits on "${decider.label}"` : `best question is "${target.label}"`;
  if (target.group === from) return { plan, from, reason: `${why}, on the open step` };
  return { plan, from, jump: target.group, reason: why };
}

/** Changes whenever an answer does, including undo and redo. Dispatch bookkeeping doesn't count. */
function answersKey(instance: FormInstance): string {
  return `${instance.id}:${instance.revisionSeq}:${Object.entries(instance.entries).map(([id, h]) => `${id}=${h.cursor}`).join(",")}`;
}

function withAnswer(instance: FormInstance, field: string, value: unknown): FormInstance {
  const history = instance.entries[field] ?? { revisions: [], cursor: -1 };
  const at = new Date(0).toISOString();
  const entry = { value, at, seq: instance.revisionSeq + 1, provenance: { source: "probe", actor: "planner", timestamp: at } };
  return { ...instance, entries: { ...instance.entries, [field]: { revisions: [...history.revisions, entry], cursor: history.revisions.length } } };
}

function asArray<T>(x: T | T[] | void | undefined): T[] {
  return x === undefined ? [] : Array.isArray(x) ? x : [x];
}
