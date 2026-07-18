/**
 * The triage task and its deterministic graders. The agent must produce two
 * things a support lead actually needs: a per-category count, and the exact
 * tickets that need urgent human escalation. Both are graded against the seeded
 * ground truth — the escalation set by F1 (the headline quality metric, since it
 * is the real judgement), the category histogram by per-bucket accuracy.
 */
import { categoryCounts, escalateIds, type World, type Category } from "./world";

export const TASK_PROMPT =
  "Triage the support inbox. Read (or classify) every ticket and reply with EXACTLY two sections:\n" +
  "1. CATEGORY COUNTS — the number of tickets in each of: billing, technical, account, feedback, abuse. " +
  "Write them as `billing: N` etc.\n" +
  "2. ESCALATIONS — the ticket ids (like T-1001) that need URGENT human escalation: an angry customer who is blocked, " +
  "an active outage, a billing dispute threatening a chargeback, or an abuse/safety issue. List ONLY the ids that qualify, " +
  "comma-separated. Do not list non-escalations.\n" +
  "Be exact and concise.";

const CATS: Category[] = ["billing", "technical", "account", "feedback", "abuse"];

/** Every distinct ticket id (T-10xx) mentioned in the ESCALATIONS part of the answer. */
export function parsePredictedEscalations(text: string): string[] {
  // Prefer the text after an "escalation" heading; fall back to the whole answer.
  const lc = text.toLowerCase();
  const idx = lc.indexOf("escalat");
  const region = idx >= 0 ? text.slice(idx) : text;
  const ids = new Set<string>();
  for (const m of region.matchAll(/T-\d{4}/g)) ids.add(m[0]);
  return [...ids];
}

/** Best-effort parse of "category: N" — the number nearest after each category word. */
export function parseCategoryCounts(text: string): Partial<Record<Category, number>> {
  const out: Partial<Record<Category, number>> = {};
  const lc = text.toLowerCase();
  for (const cat of CATS) {
    const at = lc.indexOf(cat);
    if (at < 0) continue;
    const after = text.slice(at + cat.length, at + cat.length + 12);
    const num = after.match(/\d+/);
    if (num) out[cat] = Number(num[0]);
  }
  return out;
}

export interface Grade {
  escalationPrecision: number;
  escalationRecall: number;
  escalationF1: number;
  categoryAccuracy: number;
  predictedEscalations: string[];
  expected: { escalateIds: string[]; categoryCounts: Record<Category, number> };
}

export function grade(finalText: string, world: World): Grade {
  const truthEsc = new Set(escalateIds(world));
  // Prefer the structured submission (format-independent); fall back to text.
  const pred = world.submitted ? world.submitted.escalations : parsePredictedEscalations(finalText);
  const predSet = new Set(pred.filter((id) => world.tickets.some((t) => t.id === id)));
  const tp = [...predSet].filter((id) => truthEsc.has(id)).length;
  const precision = predSet.size ? tp / predSet.size : truthEsc.size === 0 ? 1 : 0;
  const recall = truthEsc.size ? tp / truthEsc.size : 1;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  const truthCounts = categoryCounts(world);
  const predCounts = world.submitted?.counts ?? parseCategoryCounts(finalText);
  const correct = CATS.filter((c) => predCounts[c] === truthCounts[c]).length;

  return {
    escalationPrecision: precision,
    escalationRecall: recall,
    escalationF1: f1,
    categoryAccuracy: correct / CATS.length,
    predictedEscalations: [...predSet],
    expected: { escalateIds: [...truthEsc], categoryCounts: truthCounts },
  };
}
