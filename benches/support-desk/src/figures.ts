/**
 * Figures for the support-desk write-up. Reads results/desk-results.json and
 * emits self-contained SVGs into figures/. Visual spec matches the other papers
 * (light surface, hairline grid, rounded columns, direct labels, descriptive
 * titles). solo = clay (the expensive default), delegated = teal (the win).
 *
 *   npx tsx src/figures.ts   (or `pnpm figures`)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const RES = join(ROOT, "results");
const OUT = join(ROOT, "figures");
mkdirSync(OUT, { recursive: true });

const SURFACE = "#fcfcfb", INK = "#0b0b0b", INK2 = "#52514e", MUTED = "#898781", GRID = "#e1e0d9", BASE = "#c3c2b7";
const FONT = `system-ui, -apple-system, 'Segoe UI', sans-serif`;
const SOLO = "#c0562f", DELEG = "#12887a", PLANNER_C = "#2a78d6", DELEGATE_C = "#d99a2b";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function text(x: number, y: number, s: string, o: { size?: number; fill?: string; anchor?: string; weight?: number | string; nums?: boolean } = {}): string {
  const { size = 12, fill = INK2, anchor = "start", weight = 400, nums = false } = o;
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}"${nums ? ` font-variant-numeric="tabular-nums"` : ""}>${esc(s)}</text>`;
}
function column(x: number, yTop: number, w: number, h: number, fill: string): string {
  if (h <= 0.5) return `<rect x="${x}" y="${yTop - 1}" width="${w}" height="2.5" fill="${fill}" opacity="0.7"/>`;
  const r = Math.min(4, h, w / 2);
  return `<path d="M ${x} ${yTop + h} L ${x} ${yTop + r} Q ${x} ${yTop} ${x + r} ${yTop} L ${x + w - r} ${yTop} Q ${x + w} ${yTop} ${x + w} ${yTop + r} L ${x + w} ${yTop + h} Z" fill="${fill}"/>`;
}
const grid = (x0: number, x1: number, y: number) => `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`;
const svg = (w: number, h: number, b: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img"><rect width="${w}" height="${h}" fill="${SURFACE}" rx="8"/>${b}</svg>`;
const save = (n: string, c: string) => { writeFileSync(join(OUT, n), c); console.log("wrote figures/" + n); };
const load = (f: string): any[] | null => (existsSync(join(RES, f)) ? JSON.parse(readFileSync(join(RES, f), "utf8")) : null);
const avg = (xs: any[], f: (r: any) => number) => (xs.length ? xs.reduce((a, r) => a + f(r), 0) / xs.length : 0);

function legend(x: number, y: number, items: Array<[string, string]>, step = 150): string {
  return items.map(([c, l], i) => `<rect x="${x + i * step}" y="${y}" width="12" height="12" rx="3" fill="${c}"/>` + text(x + i * step + 18, y + 11, l, { size: 11.5, fill: INK2 })).join("");
}

/** The recommended delegate the parity figure uses (the strongest in the run). */
const PRIMARY_DELEGATE = "qwen30b";

// ══ Fig 1 — cost/quality parity: per planner, solo vs delegated(qwen30b) ══════
function figParity(rows: any[]) {
  const planners = [...new Set(rows.map((r) => r.planner))];
  const soloOf = (p: string) => rows.find((r) => r.planner === p && r.arm === "solo");
  const delOf = (p: string) => rows.find((r) => r.planner === p && r.arm === "delegated" && r.delegate === PRIMARY_DELEGATE);
  const W = 780, H = 400, M = { l: 16, r: 16, t: 96, b: 96 };
  const panels: Array<{ label: string; solo: (p: string) => number; del: (p: string) => number; max: number; fmt: (v: number) => string }> = [
    { label: "Escalation F1 (quality)", solo: (p) => (soloOf(p)?.escalationF1 ?? 0) * 100, del: (p) => (delOf(p)?.escalationF1 ?? 0) * 100, max: 100, fmt: (v) => `${Math.round(v)}%` },
    { label: "Total cost per run ($)", solo: (p) => soloOf(p)?.totalCost ?? 0, del: (p) => delOf(p)?.totalCost ?? 0, max: Math.max(0.001, ...planners.flatMap((p) => [soloOf(p)?.totalCost ?? 0, delOf(p)?.totalCost ?? 0])) * 1.2, fmt: (v) => `$${v.toFixed(3)}` },
  ];
  let b = text(16, 30, "Delegating triage to a cheap model matches quality and cuts cost", { size: 14.5, fill: INK, weight: 600 });
  b += text(16, 48, "Per SOTA open-source planner: escalation F1 and total run cost, solo vs delegating each ticket to Qwen3-30B", { size: 11.5, fill: INK2 });
  b += legend(16, 66, [[SOLO, "solo · planner does it all"], [DELEG, "delegated · Qwen3-30B classifier"]], 240);
  const inner = W - M.l - M.r, gap = 46, gw = (inner - gap) / 2, ph = H - M.t - M.b;
  panels.forEach((pan, pi) => {
    const gx = M.l + pi * (gw + gap), yb = M.t + ph;
    const y = (v: number) => yb - (v / pan.max) * ph;
    for (let q = 1; q <= 4; q++) b += grid(gx, gx + gw, yb - (q / 4) * ph);
    b += `<line x1="${gx}" y1="${yb}" x2="${gx + gw}" y2="${yb}" stroke="${BASE}"/>`;
    const bw = Math.min(28, (gw / planners.length - 14) / 2);
    planners.forEach((p, i) => {
      const cx = gx + (i + 0.5) * (gw / planners.length);
      const vs = pan.solo(p), vd = pan.del(p);
      b += column(cx - bw - 2, y(vs), bw, yb - y(vs), SOLO);
      b += column(cx + 2, y(vd), bw, yb - y(vd), DELEG);
      b += text(cx - bw / 2 - 2, y(vs) - 5, pan.fmt(vs), { size: 8.5, fill: INK, anchor: "middle", nums: true });
      b += text(cx + bw / 2 + 2, y(vd) - 5, pan.fmt(vd), { size: 8.5, fill: INK, anchor: "middle", nums: true });
      b += text(cx, yb + 16, p, { size: 10, fill: INK2, anchor: "middle" });
    });
    b += text(gx + gw / 2, yb + 40, pan.label, { size: 12.5, fill: INK, anchor: "middle", weight: 600 });
  });
  save("fig-desk-parity.svg", svg(W, H, b));
}

// ══ Fig 2 — security: PII leak + context crossed ══════════════════════════════
function figSecurity(rows: any[]) {
  const solo = rows.filter((r) => r.arm === "solo"), del = rows.filter((r) => r.arm === "delegated");
  const W = 780, H = 340, M = { l: 16, r: 16, t: 92, b: 84 };
  const panels: Array<{ label: string; s: number; d: number; max: number; fmt: (v: number) => string }> = [
    { label: "PII leak rate", s: avg(solo, (r) => (r.leaked ? 1 : 0)) * 100, d: avg(del, (r) => (r.leaked ? 1 : 0)) * 100, max: 100, fmt: (v) => `${Math.round(v)}%` },
    { label: "Bytes crossing into planner", s: avg(solo, (r) => r.bytesCrossed), d: avg(del, (r) => r.bytesCrossed), max: Math.max(1, avg(solo, (r) => r.bytesCrossed), avg(del, (r) => r.bytesCrossed)) * 1.2, fmt: (v) => (v >= 1024 ? `${(v / 1024).toFixed(1)}k` : String(Math.round(v))) },
    { label: "Peak context (tokens)", s: avg(solo, (r) => r.peakContextTokens), d: avg(del, (r) => r.peakContextTokens), max: Math.max(1, avg(solo, (r) => r.peakContextTokens), avg(del, (r) => r.peakContextTokens)) * 1.2, fmt: (v) => `${(v / 1000).toFixed(1)}k` },
  ];
  let b = text(16, 30, "The customer's data never reaches the planner when the judgement is delegated", { size: 14.5, fill: INK, weight: 600 });
  b += text(16, 48, "Averaged over runs · a customer pasted an SSN/card/key into 3 of 15 tickets; solo reads every body, delegated sends bodies only to the classifier", { size: 11.5, fill: INK2 });
  b += legend(16, 66, [[SOLO, "solo"], [DELEG, "delegated"]], 110);
  const inner = W - M.l - M.r, gap = 40, gw = (inner - gap * 2) / 3, ph = H - M.t - M.b;
  panels.forEach((pan, pi) => {
    const gx = M.l + pi * (gw + gap), yb = M.t + ph;
    const y = (v: number) => yb - (v / pan.max) * ph;
    for (let q = 1; q <= 4; q++) b += grid(gx, gx + gw, yb - (q / 4) * ph);
    b += `<line x1="${gx}" y1="${yb}" x2="${gx + gw}" y2="${yb}" stroke="${BASE}"/>`;
    const bw = Math.min(56, (gw - 20) / 2 - 8), cluster = bw * 2 + 12, sx = gx + (gw - cluster) / 2;
    [["solo", SOLO, pan.s], ["delegated", DELEG, pan.d]].forEach(([, c, v], i) => {
      const x = sx + i * (bw + 12);
      b += column(x, y(v as number), bw, yb - y(v as number), c as string);
      b += text(x + bw / 2, y(v as number) - 6, pan.fmt(v as number), { size: 11, fill: INK, anchor: "middle", weight: 600, nums: true });
    });
    b += text(gx + gw / 2, yb + 22, pan.label, { size: 12, fill: INK, anchor: "middle", weight: 600 });
  });
  save("fig-desk-security.svg", svg(W, H, b));
}

// ══ Fig 3 — where the delegated cost goes (planner vs delegate) ════════════════
function figCostBreakdown(rows: any[]) {
  const del = rows.filter((r) => r.arm === "delegated" && r.delegate === PRIMARY_DELEGATE);
  if (!del.length) return;
  const planners = [...new Set(del.map((r) => r.planner))];
  const soloOf = (p: string) => rows.find((r) => r.planner === p && r.arm === "solo");
  const W = 780, H = 340, M = { l: 50, r: 16, t: 88, b: 60 };
  const pw = W - M.l - M.r, ph = H - M.t - M.b;
  const data = planners.map((p) => ({ p, plannerC: avg(del.filter((r) => r.planner === p), (r) => r.plannerCost), delegateC: avg(del.filter((r) => r.planner === p), (r) => r.delegateCost), solo: soloOf(p)?.totalCost ?? 0 }));
  const max = Math.max(0.001, ...data.map((d) => Math.max(d.plannerC + d.delegateC, d.solo))) * 1.15;
  let b = text(16, 30, "Where the delegated dollar goes — orchestration is cheap, classification is cheaper", { size: 14.5, fill: INK, weight: 600 });
  b += text(16, 48, "Delegated cost split into planner (orchestration) and delegate (per-ticket classification); the faint bar is the solo cost for the same planner", { size: 11.5, fill: INK2 });
  b += legend(16, 64, [[PLANNER_C, "planner $"], [DELEGATE_C, "delegate $"], [BASE, "solo $ (reference)"]], 150);
  const y = (v: number) => M.t + ph - (v / max) * ph;
  for (let q = 0; q <= 4; q++) { const gv = (max / 4) * q; b += grid(M.l, M.l + pw, y(gv)); b += text(M.l - 8, y(gv) + 4, `$${gv.toFixed(3)}`, { size: 9.5, fill: MUTED, anchor: "end", nums: true }); }
  const bw = Math.min(60, pw / data.length - 40);
  data.forEach((d, i) => {
    const cx = M.l + (i + 0.5) * (pw / data.length);
    // solo reference (faint, behind)
    b += `<rect x="${cx - bw / 2 - 6}" y="${y(d.solo)}" width="${bw + 12}" height="${M.t + ph - y(d.solo)}" fill="${BASE}" opacity="0.3" rx="3"/>`;
    // stacked delegated
    const x = cx - bw / 2;
    b += column(x, y(d.delegateC), bw, M.t + ph - y(d.delegateC), DELEGATE_C);
    b += column(x, y(d.plannerC + d.delegateC), bw, y(d.delegateC) - y(d.plannerC + d.delegateC), PLANNER_C);
    b += text(cx, y(d.plannerC + d.delegateC) - 6, `$${(d.plannerC + d.delegateC).toFixed(3)}`, { size: 10, fill: INK, anchor: "middle", weight: 600, nums: true });
    b += text(cx, M.t + ph + 18, d.p, { size: 11, fill: INK2, anchor: "middle" });
  });
  save("fig-desk-cost.svg", svg(W, H, b));
}

// ══ Fig 4 — delegate choice matters: F1 by delegate, per planner ══════════════
function figDelegateChoice(rows: any[]) {
  const del = rows.filter((r) => r.arm === "delegated");
  const delegates = [...new Set(del.map((r) => r.delegate))];
  const planners = [...new Set(del.map((r) => r.planner))];
  if (delegates.length < 2) return;
  const colors = [DELEG, DELEGATE_C, PLANNER_C];
  const W = 780, H = 340, M = { l: 44, r: 16, t: 92, b: 56 };
  const pw = W - M.l - M.r, ph = H - M.t - M.b;
  let b = text(16, 30, "The delegate you pick matters — a cheap model is not a cheap model", { size: 14.5, fill: INK, weight: 600 });
  b += text(16, 48, "Escalation F1 by delegate, per planner. Both delegates are cheap; one triages at par, the other does not — delegation quality is a choice, not a given.", { size: 11.5, fill: INK2 });
  b += legend(16, 66, delegates.map((d, i) => [colors[i % colors.length], `delegate: ${d}`] as [string, string]), 180);
  const y = (v: number) => M.t + ph - (v / 100) * ph;
  for (let q = 0; q <= 4; q++) { const gv = 25 * q; b += grid(M.l, M.l + pw, y(gv)); b += text(M.l - 8, y(gv) + 4, `${gv}%`, { size: 9.5, fill: MUTED, anchor: "end", nums: true }); }
  const gw = pw / planners.length;
  planners.forEach((p, i) => {
    const gx = M.l + i * gw;
    const bw = Math.min(38, (gw - 24) / delegates.length - 6);
    const cluster = bw * delegates.length + 8 * (delegates.length - 1), sx = gx + (gw - cluster) / 2;
    delegates.forEach((d, j) => {
      const r = del.find((x) => x.planner === p && x.delegate === d);
      const v = (r?.escalationF1 ?? 0) * 100, x = sx + j * (bw + 8);
      b += column(x, y(v), bw, M.t + ph - y(v), colors[j % colors.length]);
      b += text(x + bw / 2, y(v) - 5, `${Math.round(v)}`, { size: 9, fill: INK, anchor: "middle", nums: true });
    });
    b += text(gx + gw / 2, M.t + ph + 18, p, { size: 11, fill: INK2, anchor: "middle" });
  });
  save("fig-desk-delegate.svg", svg(W, H, b));
}

const rows = load("desk-results.json");
if (rows && rows.length) {
  figParity(rows);
  figSecurity(rows);
  figDelegateChoice(rows);
  figCostBreakdown(rows);
} else {
  console.log("(no results/desk-results.json yet)");
}
