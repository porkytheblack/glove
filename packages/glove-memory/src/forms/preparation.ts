import { canonical, type FactPreparation, type FactRequirement, type PreparationReport, type RequirementRule } from "glove-facts";
import type { CompiledField, CompiledForm } from "./compile";
import { evaluateForm } from "./evaluate";
import { inForce } from "./history";
import type { FormEntry, FormInstance } from "./types";
import type { Provenance } from "../core/provenance";

export interface FormRequirementRule extends RequirementRule {
  /** Host attests that the verified action/outcome also fulfills these effects.
   * Only this field's onFill or its step's onComplete; never checkpoints. */
  fulfills?: Array<"field" | "step">;
}
export interface FormPreparationConfig {
  preparer: FactPreparation;
  /** Explicit allowlist. Omitted rules stay manual, including approval fields. */
  rule: (field: CompiledField, form: CompiledForm) => FormRequirementRule | undefined;
  eligible?: (field: CompiledField, instance: FormInstance) => boolean;
}
export async function prepareFormCommit<T>(config: FormPreparationConfig | undefined, compiled: CompiledForm, projected: FormInstance, provenance: Provenance, signal: AbortSignal | undefined,
  commit: (entries: Record<string, FormEntry>, report?: PreparationReport) => Promise<T>): Promise<T> {
  if (!config || !config.preparer.enabled()) return commit({});
  if (config.preparer.facts.scope().subject !== projected.subject) throw new Error("Form and facts subjects must match");
  const evaluation = evaluateForm(compiled, projected);
  const rules = new Map<string, FormRequirementRule>();
  const requirements: FactRequirement[] = [];
  for (const field of compiled.fields) {
    const rule = config.rule(field, compiled);
    if (!rule) continue;
    rules.set(field.id, rule);
    const entry = inForce(projected.entries[field.id]);
    requirements.push({ ...rule, schema: field.schema, criteria: `${rule.criteria}\n${compiled.id}@${compiled.version}: ${field.label} ${field.description ?? ""} (${field.type})`, id: field.id,
      eligible: projected.status !== "awaiting" && !projected.blockedOn && evaluation.fields.get(field.id)!.applicable && evaluation.stepOpen[field.stepId] && (config.eligible?.(field, projected) ?? true),
      ...(entry ? { current: { value: entry.value, claimId: entry.claimId } }
        : projected.entries[field.id]?.revisions.length ? { current: { value: null } } : {}),
    });
  }
  const receipts = Object.values(projected.entries).flatMap(h => h.revisions.flatMap(e => e.claimId ? [e.claimId] : []));
  return config.preparer.run({ consumer: JSON.stringify(["forms", projected.subject, projected.id]), requirements,
    context: { form: compiled.name, steps: compiled.steps.map(({ id, title, ask, preview }) => ({ id, title, ask, preview })), values: evaluation.values, held: evaluation.held, blockedOn: projected.blockedOn }, acceptedClaimIds: receipts, signal,
  }, async report => {
    const entries: Record<string, FormEntry> = {};
    let seq = projected.revisionSeq;
    // Re-evaluate eligibility as validated values open conditional steps. All
    // proposals came from the same inference; this settles gates before any
    // newly active step or executor observes the committed state.
    const candidate = structuredClone(projected);
    for (let pass = 0; pass <= requirements.length; pass++) {
      let added = false;
      for (const decision of report?.decisions ?? []) {
        if (!decision.claim || decision.claim.strength !== "sufficient" || !["sufficient", "ineligible"].includes(decision.status) || entries[decision.requirement]) continue;
        const requirement = requirements.find(r => r.id === decision.requirement)!;
        if (requirement.current) continue;
        const field = compiled.fieldById.get(decision.requirement)!;
        const rule = rules.get(field.id)!;
        const now = evaluateForm(compiled, candidate);
        if (candidate.status === "awaiting" || candidate.blockedOn || !now.fields.get(field.id)!.applicable || !now.stepOpen[field.stepId] || !(config.eligible?.(field, candidate) ?? true)) continue;
        decision.apply = true;
        decision.status = "sufficient";
        entries[field.id] = { value: decision.claim.value, at: provenance.timestamp, seq: ++seq,
          provenance: { ...provenance, source: `facts:${decision.claim.id}`, note: decision.explanation }, claimId: decision.claim.id,
          ...((rule.kind === "action" || rule.kind === "outcome") && rule.fulfills ? {
            fulfilledHooks: rule.fulfills.map(kind => kind === "field" ? `field:${field.id}` : `step:${field.stepId}`),
          } : {}),
        };
        candidate.entries[field.id] = { revisions: [entries[field.id]], cursor: 0 };
        added = true;
      }
      if (!added) break;
    }
    return { value: await commit(entries, report), acceptedClaimIds: [...receipts, ...Object.values(entries).map(e => e.claimId!)] };
  });
}
export function samePreparation(a: PreparationReport | undefined, b: PreparationReport | undefined) { return canonical(a) === canonical(b); }
