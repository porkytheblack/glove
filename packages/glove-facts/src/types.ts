import { z } from "zod";

const text = z.string().trim().min(1).max(2000);
export const FactScopeSchema = z.object({ subject: text, context: text }).strict();
export type FactScope = z.infer<typeof FactScopeSchema>;
export const FactRefSchema = z.object({ id: text, revision: z.number().int().positive() }).strict();
export type FactRef = z.infer<typeof FactRefSchema>;
export const FactInputSchema = z.object({
  text,
  value: z.json().optional(),
  source: z.object({ kind: z.enum(["message", "document", "tool", "person", "observation"]), id: text, actor: text.optional() }).strict(),
  verification: z.enum(["unverified", "verified", "ambiguous", "conflicted"]).default("unverified"),
  effectiveAt: z.iso.datetime().optional(),
  urgent: z.boolean().default(false),
  // Host-attested semantics, never writable by the model capture tool.
  evidence: z.object({ kind: z.enum(["action", "approval", "outcome"]), key: text, result: z.enum(["success", "failure", "intention"]), actor: text.optional() }).strict().optional(),
}).strict();
export type FactInput = z.input<typeof FactInputSchema>;
export type Fact = z.output<typeof FactInputSchema> & FactRef & { scope: FactScope; observedAt: string; supersedes?: FactRef };
export interface EvidenceClaim {
  id: string;
  consumer: string;
  requirement: string;
  criteria: string;
  refs: FactRef[];
  value?: unknown;
  derivation: "explicit" | "synthesized";
  strength: "sufficient" | "confirmation" | "missing" | "conflict";
  explanation: string;
  /** proposed is durable before the consumer commit; accepted requires its receipt. */
  state: "proposed" | "accepted";
}
export interface FactState {
  version: number;
  facts: Fact[];
  claims: EvidenceClaim[];
  /** Caller-chosen source operation ids make capture retries unambiguous. */
  operations: Record<string, { fingerprint: string; ref: FactRef }>;
}
export interface RequirementRule {
  kind: "information" | "action" | "approval" | "outcome";
  criteria: string;
  /** Required for non-information evidence; a host-defined obligation identity. */
  evidenceKey?: string;
  authorizedActors?: string[];
  /** Information may opt into accepting explicitly unverified statements. */
  allowUnverified?: boolean;
  schema?: z.ZodType;
}
export interface FactRequirement extends RequirementRule {
  id: string;
  eligible: boolean;
  current?: { value: unknown; claimId?: string };
}
export interface PreparationDecision {
  requirement: string;
  status: "sufficient" | "confirmation" | "missing" | "conflict" | "review" | "ineligible";
  explanation: string;
  claim?: EvidenceClaim;
  /** True only for eligible, absent values backed by validated sufficient evidence. */
  apply: boolean;
}
export interface PreparationReport {
  enabled: boolean;
  decisions: PreparationDecision[];
  urgent: Fact[];
  error?: string;
}
export interface PreparationRequest {
  consumer: string;
  requirements: FactRequirement[];
  context?: unknown;
  /** Receipts persisted in the consumer's authoritative history, including old answers. */
  acceptedClaimIds?: string[];
  signal?: AbortSignal;
}

export function scopeKey(scope: FactScope): string {
  const valid = FactScopeSchema.parse(scope);
  return JSON.stringify([valid.subject, valid.context]);
}
export function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}
export async function claimId(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value)));
  return `claim_${Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("")}`;
}
