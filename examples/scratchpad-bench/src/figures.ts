/**
 * Figure generator for PAPER.md — reads the raw benchmark results
 * (results/*.json) and emits self-contained SVG figures into figures/.
 * No dependencies; run: npx tsx src/figures.ts
 *
 * Visual spec (dataviz method): light surface #fcfcfb, hairline grid #e1e0d9,
 * ink #0b0b0b/#52514e/#898781, bars ≤24px with 4px rounded data-ends (square at
 * the baseline), 2px surface gaps, ≥8px markers with a 2px surface ring, text in
 * ink tokens (never series colors), selective direct labels.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { RunResult } from "./harness/runner";

const ROOT = join(import.meta.dirname, "..");
const RES = join(ROOT, "results");
const OUT = join(ROOT, "figures");
mkdirSync(OUT, { recursive: true });

const load = (f: string): RunResult[] => JSON.parse(readFileSync(join(RES, f), "utf8"));

// ── palette (validated) ───────────────────────────────────────────────────────
const SURFACE = "#fcfcfb";
const INK = "#0b0b0b";
const INK2 = "#52514e";
const MUTED = "#898781";
const GRID = "#e1e0d9";
const BASE = "#c3c2b7";
const BLUE = "#2a78d6"; // categorical slot 1 / emphasis accent
const GRAY = "#898781"; // de-emphasis series (emphasis form)
const RAMP5 = ["#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#104281"]; // ordinal, validated
const LIGHTBLUE = "#86b6ef";
const DARKBLUE = "#1c5cab";
const GOOD = "#0ca30c";
const CRIT = "#d03b3b";
const GOODTEXT = "#006300";
const FONT = `system-ui, -apple-system, 'Segoe UI', sans-serif`;

// ── svg helpers ───────────────────────────────────────────────────────────────
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function text(x: number, y: number, s: string, opts: { size?: number; fill?: string; anchor?: string; weight?: number | string; nums?: boolean } = {}): string {
  const { size = 12, fill = INK2, anchor = "start", weight = 400, nums = false } = opts;
  const numeric = nums ? ` font-variant-numeric="tabular-nums"` : "";
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}"${numeric}>${esc(s)}</text>`;
}
/** Column with a 4px rounded top (data-end) and a square baseline. */
function column(x: number, yTop: number, w: number, h: number, fill: string): string {
  const r = Math.min(4, h, w / 2);
  return `<path d="M ${x} ${yTop + h} L ${x} ${yTop + r} Q ${x} ${yTop} ${x + r} ${yTop} L ${x + w - r} ${yTop} Q ${x + w} ${yTop} ${x + w} ${yTop + r} L ${x + w} ${yTop + h} Z" fill="${fill}"/>`;
}
/** Horizontal bar with a 4px rounded right end, square at the left baseline. */
function hbar(x: number, y: number, w: number, h: number, fill: string): string {
  const r = Math.min(4, w, h / 2);
  return `<path d="M ${x} ${y} L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r} L ${x + w} ${y + h - r} Q ${x + w} ${y + h} ${x + w - r} ${y + h} L ${x} ${y + h} Z" fill="${fill}"/>`;
}
function dot(cx: number, cy: number, fill: string, r = 5): string {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${SURFACE}" stroke-width="2"/>`;
}
function grid(x0: number, x1: number, y: number): string {
  return `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`;
}
function svg(w: number, h: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img">
<rect width="${w}" height="${h}" fill="${SURFACE}" rx="8"/>
${body}</svg>`;
}
const save = (name: string, content: string) => {
  writeFileSync(join(OUT, name), content);
  console.log("wrote figures/" + name);
};

// ── stats ─────────────────────────────────────────────────────────────────────
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
type Agg = { pass: number; n: number; spirals: number; medTc: number; avgTurns: number; avgPeak: number };
function agg(rows: RunResult[]): Agg {
  return {
    pass: rows.filter((r) => r.ok).length,
    n: rows.length,
    spirals: rows.filter((r) => r.turns >= 29).length,
    medTc: median(rows.map((r) => r.toolCalls)),
    avgTurns: avg(rows.map((r) => r.turns)),
    avgPeak: Math.round(avg(rows.map((r) => r.peakContextTokens))),
  };
}
const scr = (f: string) => load(f).filter((r) => r.arm === "scratchpad");

const versions = [
  { v: "v1", note: "initial", rows: scr("agentic-results.json") },
  { v: "v2", note: "engine fix + preamble", rows: scr("v2-results.json") },
  { v: "v3", note: "+ enum hints", rows: scr("v3-results.json") },
  { v: "v4", note: "+ read-your-writes", rows: scr("v4-results.json") },
  { v: "v5", note: "+ parity batches", rows: scr("v5-results.json") },
].map((x) => ({ ...x, a: agg(x.rows) }));

const roster = load("roster-results.json");
const lastmile = load("lastmile-results.json");
const ROSTER_MODELS: { key: string; label: string; tier: string }[] = [
  { key: "kimi27", label: "Kimi K2.7 Code", tier: "frontier" },
  { key: "glm5", label: "GLM-5", tier: "frontier" },
  { key: "minimax3", label: "MiniMax M3", tier: "frontier" },
  { key: "dsflash", label: "DeepSeek V4 Flash", tier: "weak" },
  { key: "qwen30b", label: "Qwen3 30B A3B", tier: "weak" },
  { key: "qwen8b", label: "Qwen3 8B", tier: "weak" },
];
const cell = (rows: RunResult[], key: string, arm: string) => rows.filter((r) => r.modelKey === key && r.arm === arm);

// ══ Fig 0 — KPI strip ═════════════════════════════════════════════════════════
{
  const W = 920;
  const H = 132;
  const tiles = [
    { label: "Weak-model pass rate", value: `${Math.round((versions[0].a.pass / versions[0].a.n) * 100)}% → ${Math.round((versions[4].a.pass / versions[4].a.n) * 100)}%`, delta: "scratchpad arm · v1 → v5 · n = 35" },
    { label: "Peak context vs tool baseline", value: "2.7× smaller", delta: "median across 6 models, roster run" },
    { label: "Cheapest model scoring 7/7", value: "$0.09/M", delta: "DeepSeek V4 Flash, input price" },
    { label: "Runaway spirals (30-turn cap)", value: `${versions[0].a.spirals} → 0`, delta: "eliminated in v2, never returned" },
  ];
  const tw = (W - 16 * 2 - 12 * 3) / 4;
  let b = "";
  tiles.forEach((t, i) => {
    const x = 16 + i * (tw + 12);
    b += `<rect x="${x}" y="14" width="${tw}" height="${H - 28}" rx="8" fill="${SURFACE}" stroke="rgba(11,11,11,0.10)"/>`;
    b += text(x + 14, 40, t.label, { size: 12, fill: INK2 });
    b += text(x + 14, 74, t.value, { size: 26, fill: INK, weight: 600 });
    b += text(x + 14, 96, t.delta, { size: 11.5, fill: t.delta.startsWith("eliminated") ? GOODTEXT : MUTED });
  });
  save("fig0-kpis.svg", svg(W, H, b));
}

// ══ Fig 1 — the hardening arc (pass rate, v1..v5) ════════════════════════════
{
  const W = 760;
  const H = 368;
  const M = { l: 56, r: 24, t: 84, b: 64 };
  const pw = W - M.l - M.r;
  const ph = H - M.t - M.b;
  const y = (pct: number) => M.t + ph - (pct / 100) * ph;
  let b = text(16, 28, "Weak-model pass rate climbs from 74% to 100% as platform gaps close", { size: 15, fill: INK, weight: 600 });
  b += text(16, 46, "Scratchpad arm · 5 budget models × 7 tasks per version (n = 35) · deterministic grading", { size: 12, fill: INK2 });
  for (const t of [0, 25, 50, 75, 100]) {
    b += grid(M.l, W - M.r, y(t));
    b += text(M.l - 8, y(t) + 4, `${t}%`, { size: 11, fill: MUTED, anchor: "end", nums: true });
  }
  const bw = 24;
  const slot = pw / versions.length;
  versions.forEach((vv, i) => {
    const pct = (vv.a.pass / vv.a.n) * 100;
    const x = M.l + i * slot + slot / 2 - bw / 2;
    b += column(x, y(pct), bw, ph - (y(pct) - M.t), RAMP5[i]);
    b += text(x + bw / 2, y(pct) - 8, `${vv.a.pass}/${vv.a.n}`, { size: 12.5, fill: INK, anchor: "middle", weight: 600, nums: true });
    b += text(M.l + i * slot + slot / 2, M.t + ph + 20, vv.v, { size: 12.5, fill: INK, anchor: "middle", weight: 600 });
    b += text(M.l + i * slot + slot / 2, M.t + ph + 36, vv.note, { size: 11, fill: MUTED, anchor: "middle" });
  });
  b += `<line x1="${M.l}" y1="${M.t + ph}" x2="${W - M.r}" y2="${M.t + ph}" stroke="${BASE}" stroke-width="1"/>`;
  save("fig1-hardening.svg", svg(W, H, b));
}

// ══ Fig 2 — cost of the answer (small multiples) ═════════════════════════════
{
  const W = 920;
  const H = 300;
  const panels = [
    { title: "Median tool calls", vals: versions.map((v) => v.a.medTc), fmt: (x: number) => String(x), max: 8 },
    { title: "Average turns", vals: versions.map((v) => Number(v.a.avgTurns.toFixed(1))), fmt: (x: number) => x.toFixed(1), max: 12 },
    { title: "Average peak context (tokens)", vals: versions.map((v) => v.a.avgPeak), fmt: (x: number) => x.toLocaleString(), max: 3200 },
  ];
  let b = text(16, 28, "The cost of an answer collapses and stays flat", { size: 15, fill: INK, weight: 600 });
  b += text(16, 46, "Same scratchpad arm across hardening versions — fewer calls, fewer turns, small prompts", { size: 12, fill: INK2 });
  const pwAll = (W - 16 * 2 - 28 * 2) / 3;
  panels.forEach((p, pi) => {
    const x0 = 16 + pi * (pwAll + 28);
    const M = { l: 6, r: 6, t: 76, b: 40 };
    const ph = H - M.t - M.b;
    const y = (v: number) => M.t + ph - (v / p.max) * ph;
    b += text(x0 + 6, 68, p.title, { size: 12.5, fill: INK, weight: 600 });
    b += `<line x1="${x0 + M.l}" y1="${M.t + ph}" x2="${x0 + pwAll - M.r}" y2="${M.t + ph}" stroke="${BASE}" stroke-width="1"/>`;
    const slot = (pwAll - M.l - M.r) / p.vals.length;
    const bw = 22;
    p.vals.forEach((v, i) => {
      const x = x0 + M.l + i * slot + slot / 2 - bw / 2;
      b += column(x, y(v), bw, ph - (y(v) - M.t), BLUE);
      b += text(x + bw / 2, y(v) - 7, p.fmt(v), { size: 11.5, fill: INK, anchor: "middle", weight: 600, nums: true });
      b += text(x0 + M.l + i * slot + slot / 2, M.t + ph + 18, versions[i].v, { size: 11, fill: MUTED, anchor: "middle" });
    });
  });
  save("fig2-efficiency.svg", svg(W, H, b));
}

// ══ Fig 3 — roster A/B: pass by model, both arms ═════════════════════════════
{
  const W = 880;
  const H = 452;
  const M = { l: 172, r: 150, t: 88, b: 36 };
  const pw = W - M.l - M.r;
  const rowH = 50;
  const x = (v: number) => M.l + (v / 7) * pw;
  let b = text(16, 28, "One SQL tool beats 32 folded tools — at every capability tier", { size: 15, fill: INK, weight: 600 });
  b += text(16, 46, "Tasks passed out of 7 per model · same servers, same tasks, same grader in both arms", { size: 12, fill: INK2 });
  // legend (2 series)
  b += `<rect x="${16}" y="${58}" width="12" height="12" rx="3" fill="${GRAY}"/>` + text(34, 68, "baseline: 32 MCP tools folded directly", { size: 12, fill: INK2 });
  b += `<rect x="${292}" y="${58}" width="12" height="12" rx="3" fill="${BLUE}"/>` + text(310, 68, "scratchpad: one execute_sql over the same capabilities", { size: 12, fill: INK2 });
  for (const t of [0, 1, 2, 3, 4, 5, 6, 7]) {
    b += `<line x1="${x(t)}" y1="${M.t}" x2="${x(t)}" y2="${M.t + ROSTER_MODELS.length * rowH}" stroke="${GRID}" stroke-width="1"/>`;
    b += text(x(t), M.t + ROSTER_MODELS.length * rowH + 18, String(t), { size: 11, fill: MUTED, anchor: "middle", nums: true });
  }
  ROSTER_MODELS.forEach((m, i) => {
    const yTop = M.t + i * rowH;
    const base = cell(roster, m.key, "baseline").filter((r) => r.ok).length;
    const s = cell(roster, m.key, "scratchpad").filter((r) => r.ok).length;
    b += text(M.l - 10, yTop + 18, m.label, { size: 12.5, fill: INK, anchor: "end", weight: 600 });
    b += text(M.l - 10, yTop + 33, m.tier === "frontier" ? "OSS frontier" : "cheap / weak", { size: 10.5, fill: MUTED, anchor: "end" });
    b += hbar(M.l, yTop + 6, x(base) - M.l, 16, GRAY);
    b += hbar(M.l, yTop + 24, x(s) - M.l, 16, BLUE); // 2px surface gap between the pair
    b += text(x(base) + 8, yTop + 18, `${base}/7`, { size: 11.5, fill: INK2, nums: true });
    b += text(x(s) + 8, yTop + 36, `${s}/7`, { size: 11.5, fill: INK, weight: 600, nums: true });
  });
  // tier separator
  const sepY = M.t + 3 * rowH - 3;
  b += `<line x1="${M.l - 160}" y1="${sepY}" x2="${W - M.r + 60}" y2="${sepY}" stroke="${BASE}" stroke-width="1" stroke-dasharray="none"/>`;
  save("fig3-roster.svg", svg(W, H, b));
}

// ══ Fig 4 — peak context dumbbells ═══════════════════════════════════════════
{
  const W = 920;
  const H = 400;
  const M = { l: 172, r: 170, t: 82, b: 40 };
  const pw = W - M.l - M.r;
  const rowH = 42;
  const maxTok = 7000;
  const x = (v: number) => M.l + (v / maxTok) * pw;
  let b = text(16, 28, "Peak context shrinks 2.4–3.2× — schemas and row dumps never enter the window", { size: 15, fill: INK, weight: 600 });
  b += text(16, 46, "Median peak prompt tokens per model (roster run) · baseline → scratchpad", { size: 12, fill: INK2 });
  b += dot(22, 62, LIGHTBLUE) + text(34, 66, "baseline", { size: 12, fill: INK2 });
  b += dot(122, 62, DARKBLUE) + text(134, 66, "scratchpad", { size: 12, fill: INK2 });
  for (const t of [0, 2000, 4000, 6000]) {
    b += `<line x1="${x(t)}" y1="${M.t}" x2="${x(t)}" y2="${M.t + ROSTER_MODELS.length * rowH}" stroke="${GRID}" stroke-width="1"/>`;
    b += text(x(t), M.t + ROSTER_MODELS.length * rowH + 18, t === 0 ? "0" : `${t / 1000}k`, { size: 11, fill: MUTED, anchor: "middle", nums: true });
  }
  ROSTER_MODELS.forEach((m, i) => {
    const cy = M.t + i * rowH + rowH / 2 - 4;
    const base = median(cell(roster, m.key, "baseline").map((r) => r.peakContextTokens));
    const s = median(cell(roster, m.key, "scratchpad").map((r) => r.peakContextTokens));
    b += text(M.l - 10, cy + 4, m.label, { size: 12.5, fill: INK, anchor: "end", weight: 600 });
    b += `<line x1="${x(s)}" y1="${cy}" x2="${x(base)}" y2="${cy}" stroke="${BASE}" stroke-width="2"/>`;
    b += dot(x(base), cy, LIGHTBLUE) + dot(x(s), cy, DARKBLUE);
    b += text(x(base) + 12, cy + 4, base.toLocaleString(), { size: 11, fill: MUTED, nums: true });
    b += text(W - M.r + 26, cy + 4, `${(base / s).toFixed(1)}× smaller`, { size: 12.5, fill: GOODTEXT, weight: 600, nums: true });
  });
  save("fig4-context.svg", svg(W, H, b));
}

// ══ Fig 5 — context pressure (16k window) ════════════════════════════════════
{
  const W = 760;
  const H = 392;
  const M = { l: 64, r: 24, t: 88, b: 76 };
  const pw = W - M.l - M.r;
  const ph = H - M.t - M.b;
  const maxTok = 18000;
  const y = (v: number) => M.t + ph - (v / maxTok) * ph;
  const demo = load("compaction-results.json").filter((r) => r.scenario === "count-open-prs");
  const models = [
    { key: "deepseek", label: "DeepSeek V3.2" },
    { key: "glm", label: "GLM 4.7 Flash" },
    { key: "kimi", label: "Kimi K2.5" },
  ];
  let b = text(16, 28, "Under a 16k window, the baseline saturates and miscounts; the scratchpad doesn't notice", { size: 15, fill: INK, weight: 600 });
  b += text(16, 46, "“How many PRs are open?” at scale 8 (~320 PRs) · peak prompt tokens; ✓/✗ = graded answer", { size: 12, fill: INK2 });
  b += `<rect x="16" y="58" width="12" height="12" rx="3" fill="${GRAY}"/>` + text(34, 68, "baseline", { size: 12, fill: INK2 });
  b += `<rect x="110" y="58" width="12" height="12" rx="3" fill="${BLUE}"/>` + text(128, 68, "scratchpad", { size: 12, fill: INK2 });
  for (const t of [0, 4000, 8000, 12000, 16000]) {
    b += grid(M.l, W - M.r, y(t));
    b += text(M.l - 8, y(t) + 4, t === 0 ? "0" : `${t / 1000}k`, { size: 11, fill: MUTED, anchor: "end", nums: true });
  }
  // the window limit
  b += `<line x1="${M.l}" y1="${y(16000)}" x2="${W - M.r}" y2="${y(16000)}" stroke="${CRIT}" stroke-width="1"/>`;
  b += text(W - M.r, y(16000) - 6, "16k context window", { size: 11, fill: CRIT, anchor: "end" });
  const slot = pw / models.length;
  const bw = 24;
  models.forEach((m, i) => {
    const basePeak = Math.max(...cell(demo, m.key, "baseline").map((r) => r.peakContextTokens));
    const sPeak = Math.max(...cell(demo, m.key, "scratchpad").map((r) => r.peakContextTokens));
    const baseOk = cell(demo, m.key, "baseline").every((r) => r.ok);
    const sOk = cell(demo, m.key, "scratchpad").every((r) => r.ok);
    const cx = M.l + i * slot + slot / 2;
    const xb = cx - bw - 1; // 2px surface gap between the pair
    const xs = cx + 1;
    b += column(xb, y(basePeak), bw, ph - (y(basePeak) - M.t), GRAY);
    b += column(xs, y(sPeak), bw, ph - (y(sPeak) - M.t), BLUE);
    b += text(xb + bw / 2, y(basePeak) - 22, baseOk ? "✓ pass" : "✗ fail", { size: 11.5, fill: baseOk ? GOOD : CRIT, anchor: "middle", weight: 600 });
    b += text(xb + bw / 2, y(basePeak) - 8, `${(basePeak / 1000).toFixed(1)}k`, { size: 11, fill: INK2, anchor: "middle", nums: true });
    b += text(xs + bw / 2, y(sPeak) - 22, sOk ? "✓ pass" : "✗ fail", { size: 11.5, fill: sOk ? GOOD : CRIT, anchor: "middle", weight: 600 });
    b += text(xs + bw / 2, y(sPeak) - 8, `${(sPeak / 1000).toFixed(1)}k`, { size: 11, fill: INK2, anchor: "middle", nums: true });
    b += text(cx, M.t + ph + 20, m.label, { size: 12, fill: INK, anchor: "middle", weight: 600 });
  });
  b += `<line x1="${M.l}" y1="${M.t + ph}" x2="${W - M.r}" y2="${M.t + ph}" stroke="${BASE}" stroke-width="1"/>`;
  save("fig5-pressure.svg", svg(W, H, b));
}

// ══ Fig 6 — last mile: before → after on the cheapest tier ═══════════════════
{
  const W = 900;
  const H = 312;
  const M = { l: 168, r: 350, t: 92, b: 40 };
  const pw = W - M.l - M.r;
  const rowH = 52;
  const x = (v: number) => M.l + (v / 7) * pw;
  const weak = [
    { key: "qwen30b", label: "Qwen3 30B A3B", cause: "write reported no row count" },
    { key: "qwen8b", label: "Qwen3 8B", cause: "script discarded SELECT rows" },
    { key: "dsflash", label: "DeepSeek V4 Flash", cause: "control — no regression" },
  ];
  let b = text(16, 28, "Autopsy of the “capacity floor”: three residual failures, all platform gaps", { size: 15, fill: INK, weight: 600 });
  b += text(16, 46, "Tasks passed out of 7, scratchpad arm · before (roster) → after (last-mile fixes)", { size: 12, fill: INK2 });
  b += dot(22, 62, LIGHTBLUE) + text(34, 66, "before", { size: 12, fill: INK2 });
  b += dot(104, 62, DARKBLUE) + text(116, 66, "after", { size: 12, fill: INK2 });
  for (const t of [0, 1, 2, 3, 4, 5, 6, 7]) {
    b += `<line x1="${x(t)}" y1="${M.t}" x2="${x(t)}" y2="${M.t + weak.length * rowH}" stroke="${GRID}" stroke-width="1"/>`;
    b += text(x(t), M.t + weak.length * rowH + 18, String(t), { size: 11, fill: MUTED, anchor: "middle", nums: true });
  }
  weak.forEach((m, i) => {
    const cy = M.t + i * rowH + rowH / 2 - 6;
    const before = cell(roster, m.key, "scratchpad").filter((r) => r.ok).length;
    const after = cell(lastmile, m.key, "scratchpad").filter((r) => r.ok).length;
    b += text(M.l - 10, cy + 4, m.label, { size: 12.5, fill: INK, anchor: "end", weight: 600 });
    if (after !== before) b += `<line x1="${x(before)}" y1="${cy}" x2="${x(after)}" y2="${cy}" stroke="${BASE}" stroke-width="2"/>`;
    b += dot(x(before), cy, LIGHTBLUE) + dot(x(after), cy, DARKBLUE);
    b += text(M.l + pw + 18, cy + 4, `${before}/7 → ${after}/7`, { size: 11.5, fill: INK, weight: 600, nums: true });
    b += text(M.l + pw + 110, cy + 4, m.cause, { size: 11, fill: MUTED });
  });
  save("fig6-lastmile.svg", svg(W, H, b));
}

console.log("all figures written to figures/");

// ══ Lisp arm figures (fig7–fig9) ══════════════════════════════════════════════
// Best-known lisp cells: later runs override earlier per (model, scenario).
const AQUA = "#1baf7a"; // categorical slot 2 — sub-3:1 on light surface, so every
// bar carries a visible end label (the relief rule) and the paper keeps a table.
const lispBest = new Map<string, RunResult>();
for (const f of ["lisp-ab3-results.json", "lisp-ab4-results.json", "lisp-ab5-results.json"]) {
  try {
    for (const r of JSON.parse(readFileSync(join(RES, f), "utf8")) as RunResult[]) {
      lispBest.set(`${r.modelKey}|${r.scenario}`, r);
    }
  } catch {
    /* run not present */
  }
}
const sqlBest = new Map<string, RunResult>();
for (const f of ["agentic-results.json", "v5-results.json", "roster-results.json", "lastmile-results.json"]) {
  try {
    for (const r of JSON.parse(readFileSync(join(RES, f), "utf8")) as RunResult[]) {
      sqlBest.set(`${r.modelKey}|${r.scenario}|${r.arm}`, r);
    }
  } catch {
    /* run not present */
  }
}
const LISP_MODELS: { key: string; label: string; tier: string }[] = [
  { key: "kimi27", label: "Kimi K2.7 Code", tier: "frontier" },
  { key: "glm5", label: "GLM-5", tier: "frontier" },
  { key: "minimax3", label: "MiniMax M3", tier: "frontier" },
  { key: "deepseek", label: "DeepSeek V3.2", tier: "frontier" },
  { key: "kimi", label: "Kimi K2.5", tier: "mid" },
  { key: "minimax", label: "MiniMax M2.5", tier: "mid" },
  { key: "xiaomi", label: "Xiaomi MiMo v2.5", tier: "mid" },
  { key: "glm", label: "GLM 4.7 Flash", tier: "mid" },
  { key: "dsflash", label: "DeepSeek V4 Flash", tier: "weak" },
  { key: "qwen30b", label: "Qwen3 30B A3B", tier: "weak" },
  { key: "qwen8b", label: "Qwen3 8B", tier: "weak" },
];
const SCEN7 = ["count-open-prs", "sentry-billing-unresolved", "merged-prs-open-linear", "busiest-assignee", "high-urgency-triggered", "email-top-error", "compose-verify-issues"];

// ── Fig 7: three arms per model ──
{
  const W = 880;
  const H = 96 + 11 * 62 + 40;
  const M = { l: 172, r: 150, t: 96 };
  const pw = W - M.l - M.r;
  const rowH = 62;
  const x = (v: number) => M.l + (v / 7) * pw;
  let b = text(16, 28, "Same catalog, three surfaces: the REPL reaches graded parity with SQL", { size: 15, fill: INK, weight: 600 });
  b += text(16, 46, "Tasks passed out of 7 per model · identical servers, tasks, and graders in every arm", { size: 12, fill: INK2 });
  b += `<rect x="16" y="58" width="12" height="12" rx="3" fill="${GRAY}"/>` + text(34, 68, "baseline: 32 tools", { size: 12, fill: INK2 });
  b += `<rect x="176" y="58" width="12" height="12" rx="3" fill="${BLUE}"/>` + text(194, 68, "SQL: execute_sql", { size: 12, fill: INK2 });
  b += `<rect x="336" y="58" width="12" height="12" rx="3" fill="${AQUA}"/>` + text(354, 68, "Lisp: execute_lisp", { size: 12, fill: INK2 });
  for (const t of [0, 1, 2, 3, 4, 5, 6, 7]) {
    b += `<line x1="${x(t)}" y1="${M.t}" x2="${x(t)}" y2="${M.t + 11 * rowH}" stroke="${GRID}" stroke-width="1"/>`;
    b += text(x(t), M.t + 11 * rowH + 18, String(t), { size: 11, fill: MUTED, anchor: "middle", nums: true });
  }
  LISP_MODELS.forEach((m, i) => {
    const yTop = M.t + i * rowH;
    const base = SCEN7.filter((s) => sqlBest.get(`${m.key}|${s}|baseline`)?.ok).length;
    const sql = SCEN7.filter((s) => sqlBest.get(`${m.key}|${s}|scratchpad`)?.ok).length;
    const lispCells = SCEN7.map((s) => lispBest.get(`${m.key}|${s}`));
    const lisp = lispCells.filter((r) => r?.ok).length;
    const lispErr = lispCells.filter((r) => r?.errored).length;
    b += text(M.l - 10, yTop + 22, m.label, { size: 12.5, fill: INK, anchor: "end", weight: 600 });
    b += text(M.l - 10, yTop + 37, m.tier === "frontier" ? "OSS frontier" : m.tier === "mid" ? "mid tier" : "cheap / weak", { size: 10.5, fill: MUTED, anchor: "end" });
    b += hbar(M.l, yTop + 6, Math.max(x(base) - M.l, 2), 14, GRAY);
    b += hbar(M.l, yTop + 22, Math.max(x(sql) - M.l, 2), 14, BLUE);
    b += hbar(M.l, yTop + 38, Math.max(x(lisp) - M.l, 2), 14, AQUA);
    b += text(x(base) + 7, yTop + 17, `${base}/7`, { size: 11, fill: INK2, nums: true });
    b += text(x(sql) + 7, yTop + 33, `${sql}/7`, { size: 11, fill: INK, weight: 600, nums: true });
    b += text(x(lisp) + 7, yTop + 49, `${lisp}/7${lispErr ? ` (+${lispErr} provider err)` : ""}`, { size: 11, fill: INK, weight: 600, nums: true });
  });
  save("fig7-threearms.svg", svg(W, H, b));
}

// ── Fig 8: the lisp fluency arc ──
{
  const rounds = [
    { v: "run 1", note: "as designed", pass: 62 },
    { v: "run 2", note: "+ batch 1", pass: 64 },
    { v: "run 3", note: "+ batch 2", pass: 72 },
    { v: "run 4", note: "+ batch 3", pass: 73 },
    { v: "run 5", note: "+ batch 4", pass: 74 },
  ];
  const W = 760;
  const H = 368;
  const M = { l: 56, r: 24, t: 84, b: 64 };
  const pw = W - M.l - M.r;
  const ph = H - M.t - M.b;
  const y = (pct: number) => M.t + ph - (pct / 100) * ph;
  let b = text(16, 28, "The Lisp arm repeats the SQL arc: 81% → 96% in four transcript-driven batches", { size: 15, fill: INK, weight: 600 });
  b += text(16, 46, "11 models × 7 tasks per run (n = 77) · same grading · two residual misses are provider 429s", { size: 12, fill: INK2 });
  for (const t of [0, 25, 50, 75, 100]) {
    b += grid(M.l, W - M.r, y(t));
    b += text(M.l - 8, y(t) + 4, `${t}%`, { size: 11, fill: MUTED, anchor: "end", nums: true });
  }
  const bw = 24;
  const slot = pw / rounds.length;
  rounds.forEach((r, i) => {
    const pct = (r.pass / 77) * 100;
    const xx = M.l + i * slot + slot / 2 - bw / 2;
    b += column(xx, y(pct), bw, ph - (y(pct) - M.t), RAMP5[i]);
    b += text(xx + bw / 2, y(pct) - 8, `${r.pass}/77`, { size: 12.5, fill: INK, anchor: "middle", weight: 600, nums: true });
    b += text(M.l + i * slot + slot / 2, M.t + ph + 20, r.v, { size: 12.5, fill: INK, anchor: "middle", weight: 600 });
    b += text(M.l + i * slot + slot / 2, M.t + ph + 36, r.note, { size: 11, fill: MUTED, anchor: "middle" });
  });
  b += `<line x1="${M.l}" y1="${M.t + ph}" x2="${W - M.r}" y2="${M.t + ph}" stroke="${BASE}" stroke-width="1"/>`;
  save("fig8-lisp-arc.svg", svg(W, H, b));
}

// ── Fig 9: the structural scenarios ──
{
  const W = 760;
  const H = 330;
  const M = { l: 56, r: 24, t: 96, b: 56 };
  const pw = W - M.l - M.r;
  const ph = H - M.t - M.b;
  const groups = [
    { label: "incident-branch", sub: "decide-and-act, graded on the correct branch", vals: [{ n: 9, d: 10 }, { n: 9, d: 10 }, { n: 10, d: 10 }] },
    { label: "open-prs-breakdown", sub: "two-part answer from one read", vals: [{ n: 7, d: 11 }, { n: 11, d: 11 }, { n: 9, d: 10 }] },
  ];
  const y = (frac: number) => M.t + ph - frac * ph;
  let b = text(16, 28, "The scenarios SQL can't shape: the REPL sweeps decide-and-act", { size: 15, fill: INK, weight: 600 });
  b += text(16, 46, "Pass rate per arm · Lisp is the only 10/10 on branching, in one call on three models", { size: 12, fill: INK2 });
  b += `<rect x="16" y="58" width="12" height="12" rx="3" fill="${GRAY}"/>` + text(34, 68, "baseline", { size: 12, fill: INK2 });
  b += `<rect x="116" y="58" width="12" height="12" rx="3" fill="${BLUE}"/>` + text(134, 68, "SQL", { size: 12, fill: INK2 });
  b += `<rect x="196" y="58" width="12" height="12" rx="3" fill="${AQUA}"/>` + text(214, 68, "Lisp", { size: 12, fill: INK2 });
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    b += grid(M.l, W - M.r, y(t));
    b += text(M.l - 8, y(t) + 4, `${Math.round(t * 100)}%`, { size: 11, fill: MUTED, anchor: "end", nums: true });
  }
  const colors = [GRAY, BLUE, AQUA];
  const slot = pw / groups.length;
  const bw = 24;
  groups.forEach((g, gi) => {
    const cx = M.l + gi * slot + slot / 2;
    g.vals.forEach((v, vi) => {
      const xx = cx + (vi - 1) * (bw + 2) - bw / 2;
      const frac = v.n / v.d;
      b += column(xx, y(frac), bw, ph - (y(frac) - M.t), colors[vi]);
      b += text(xx + bw / 2, y(frac) - 8, `${v.n}/${v.d}`, { size: 11.5, fill: INK, anchor: "middle", weight: 600, nums: true });
    });
    b += text(cx, M.t + ph + 20, g.label, { size: 12.5, fill: INK, anchor: "middle", weight: 600 });
    b += text(cx, M.t + ph + 36, g.sub, { size: 11, fill: MUTED, anchor: "middle" });
  });
  b += `<line x1="${M.l}" y1="${M.t + ph}" x2="${W - M.r}" y2="${M.t + ph}" stroke="${BASE}" stroke-width="1"/>`;
  save("fig9-structural.svg", svg(W, H, b));
}

// ══ Fig 10 — the choice study; Fig 11 — the complex suite ═══════════════════
{
  const study = load("bothstudy-results.json");
  const W = 880;
  const H = 96 + 9 * 40 + 44;
  const M = { l: 236, r: 130, t: 96 };
  const rowH = 40;
  const pw = W - M.l - M.r;
  const SC = [...new Set(study.map((r) => r.scenario))];
  const mixOf = (r: RunResult) => {
    const m = (r as unknown as { toolMix?: Record<string, number> }).toolMix ?? {};
    const sql = (m.execute_sql ?? 0) + (m.explain_sql ?? 0);
    const lisp = (m.execute_lisp ?? 0) + (m.explain_lisp ?? 0);
    return sql > 0 && lisp === 0 ? "sql" : lisp > 0 && sql === 0 ? "lisp" : sql > 0 && lisp > 0 ? "mixed" : "none";
  };
  let b = text(16, 28, "Given both surfaces, models choose SQL — until the task is branch-shaped", { size: 15, fill: INK, weight: 600 });
  b += text(16, 46, "Arm 'both' (execute_sql + execute_lisp, neutral preamble) · 11 models per scenario · which surface each cell used", { size: 12, fill: INK2 });
  b += `<rect x="16" y="58" width="12" height="12" rx="3" fill="${BLUE}"/>` + text(34, 68, "SQL only", { size: 12, fill: INK2 });
  b += `<rect x="116" y="58" width="12" height="12" rx="3" fill="${AQUA}"/>` + text(134, 68, "Lisp only", { size: 12, fill: INK2 });
  b += `<rect x="216" y="58" width="12" height="12" rx="3" fill="${GRAY}"/>` + text(234, 68, "mixed", { size: 12, fill: INK2 });
  SC.forEach((s, i) => {
    const rows = study.filter((r) => r.scenario === s);
    const c = { sql: 0, lisp: 0, mixed: 0, none: 0 };
    for (const r of rows) c[mixOf(r)]++;
    const y0 = M.t + i * rowH;
    const total = rows.length;
    const seg = (n: number) => (n / total) * pw;
    let x = M.l;
    b += text(M.l - 10, y0 + 17, s, { size: 12, fill: INK, anchor: "end", weight: 600 });
    for (const [key, color] of [["sql", BLUE], ["lisp", AQUA], ["mixed", GRAY]] as const) {
      const wSeg = seg(c[key]);
      if (wSeg > 0) {
        b += `<rect x="${x}" y="${y0 + 4}" width="${Math.max(wSeg - 2, 1)}" height="18" rx="3" fill="${color}"/>`;
        if (wSeg > 26) b += text(x + wSeg / 2 - 1, y0 + 17, String(c[key]), { size: 11, fill: key === "lisp" ? INK : SURFACE, anchor: "middle", weight: 600, nums: true });
        x += wSeg;
      }
    }
    const p = rows.filter((r) => r.ok).length;
    b += text(M.l + pw + 12, y0 + 17, `${p}/${total} pass`, { size: 11, fill: MUTED, nums: true });
  });
  save("fig10-choice.svg", svg(W, H, b));
}
{
  const complex = load("complex-results.json");
  const W = 880;
  const H = 356;
  const M = { l: 56, r: 24, t: 96, b: 74 };
  const pw = W - M.l - M.r;
  const ph = H - M.t - M.b;
  const ARMS = [
    { key: "baseline", label: "baseline", color: GRAY },
    { key: "scratchpad", label: "SQL", color: BLUE },
    { key: "lisp", label: "Lisp", color: AQUA },
    { key: "both", label: "both", color: DARKBLUE },
  ];
  const SCX = [
    { id: "reconcile-ghost-issues", label: "negation join" },
    { id: "repo-health-report", label: "grouped report" },
    { id: "escalate-hot-services", label: "conditional escalation" },
  ];
  const y = (frac: number) => M.t + ph - frac * ph;
  let b = text(16, 28, "The hard suite: every arm drops to 67–73% — and SQL is worst at its own negation join", { size: 15, fill: INK, weight: 600 });
  b += text(16, 46, "Pass rate per arm, 11 models per cell · complexity, not surface parity, is the open frontier", { size: 12, fill: INK2 });
  ARMS.forEach((a, i) => {
    b += `<rect x="${16 + i * 130}" y="58" width="12" height="12" rx="3" fill="${a.color}"/>` + text(34 + i * 130, 68, a.label, { size: 12, fill: INK2 });
  });
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    b += grid(M.l, W - M.r, y(t));
    b += text(M.l - 8, y(t) + 4, `${Math.round(t * 100)}%`, { size: 11, fill: MUTED, anchor: "end", nums: true });
  }
  const slot = pw / SCX.length;
  const bw = 22;
  SCX.forEach((s, si) => {
    const cx = M.l + si * slot + slot / 2;
    ARMS.forEach((a, ai) => {
      const rows = complex.filter((r) => r.scenario === s.id && r.arm === a.key);
      const p = rows.filter((r) => r.ok).length;
      const frac = rows.length ? p / rows.length : 0;
      const xx = cx + (ai - 1.5) * (bw + 2) - bw / 2 + bw / 2;
      b += column(xx, y(frac), bw, ph - (y(frac) - M.t), a.color);
      b += text(xx + bw / 2, y(frac) - 7, `${p}/${rows.length}`, { size: 10.5, fill: INK, anchor: "middle", weight: 600, nums: true });
    });
    b += text(cx, M.t + ph + 20, s.label, { size: 12.5, fill: INK, anchor: "middle", weight: 600 });
    b += text(cx, M.t + ph + 36, s.id, { size: 10.5, fill: MUTED, anchor: "middle" });
  });
  b += `<line x1="${M.l}" y1="${M.t + ph}" x2="${W - M.r}" y2="${M.t + ph}" stroke="${BASE}" stroke-width="1"/>`;
  save("fig11-complex.svg", svg(W, H, b));
}

// ══ Fig 12 — take away the manual: primed vs bare ═══════════════════════════
{
  const bare = load("bare-results.json");
  const primedS = new Map<string, RunResult>();
  for (const f of ["v5-results.json", "roster-results.json", "lastmile-results.json"]) {
    try {
      for (const r of JSON.parse(readFileSync(join(RES, f), "utf8")) as RunResult[]) {
        if (r.arm === "scratchpad") primedS.set(`${r.modelKey}|${r.scenario}`, r);
      }
    } catch { /* absent */ }
  }
  const primedL = new Map<string, RunResult>();
  for (const f of ["lisp-ab3-results.json", "lisp-ab4-results.json", "lisp-ab5-results.json"]) {
    try {
      for (const r of JSON.parse(readFileSync(join(RES, f), "utf8")) as RunResult[]) {
        primedL.set(`${r.modelKey}|${r.scenario}`, r);
      }
    } catch { /* absent */ }
  }
  const W = 920;
  const H = 96 + 11 * 40 + 40;
  const rowH = 40;
  const panels = [
    { title: "SQL scratchpad", primed: primedS, x0: 56 },
    { title: "Lisp REPL", primed: primedL, x0: 500 },
  ];
  const pw = 320;
  let b = text(16, 28, "Take away the manual: the preamble is load-bearing only below ~30B", { size: 15, fill: INK, weight: 600 });
  b += text(16, 46, "Tasks passed of 7 per model — primed preamble → bare (role only; discovery in-band) · dark = primed, light = bare", { size: 12, fill: INK2 });
  b += dot(22, 62, DARKBLUE) + text(34, 66, "primed", { size: 12, fill: INK2 });
  b += dot(104, 62, LIGHTBLUE) + text(116, 66, "bare", { size: 12, fill: INK2 });
  for (const p of panels) {
    const x = (v: number) => p.x0 + 130 + (v / 7) * (pw - 130);
    b += text(p.x0 + 130, 92, p.title, { size: 12.5, fill: INK, weight: 600 });
    for (const t of [0, 7]) {
      b += `<line x1="${x(t)}" y1="${100}" x2="${x(t)}" y2="${100 + 11 * rowH - 14}" stroke="${GRID}" stroke-width="1"/>`;
    }
    ROSTER_MODELS.concat([]).length; // noop keep tslint calm
    const models = ["kimi27", "glm5", "minimax3", "deepseek", "kimi", "minimax", "xiaomi", "glm", "dsflash", "qwen30b", "qwen8b"];
    const labels: Record<string, string> = { kimi27: "Kimi K2.7", glm5: "GLM-5", minimax3: "MiniMax M3", deepseek: "DeepSeek V3.2", kimi: "Kimi K2.5", minimax: "MiniMax M2.5", xiaomi: "MiMo v2.5", glm: "GLM 4.7 Flash", dsflash: "DS V4 Flash", qwen30b: "Qwen3 30B", qwen8b: "Qwen3 8B" };
    models.forEach((m, i) => {
      const cy = 108 + i * rowH;
      const pv = SCEN7.filter((s) => p.primed.get(`${m}|${s}`)?.ok).length;
      const arm = p.title.startsWith("SQL") ? "scratchpad" : "lisp";
      const bv = bare.filter((r) => r.modelKey === m && r.arm === arm && r.ok).length;
      b += text(p.x0 + 122, cy + 4, labels[m], { size: 11.5, fill: INK, anchor: "end", weight: 600 });
      if (pv !== bv) b += `<line x1="${x(bv)}" y1="${cy}" x2="${x(pv)}" y2="${cy}" stroke="${BASE}" stroke-width="2"/>`;
      b += dot(x(pv), cy, DARKBLUE) + dot(x(bv), cy, LIGHTBLUE);
      b += text(x(7) + 12, cy + 4, `${pv}→${bv}`, { size: 11, fill: bv < pv - 1 ? CRIT : MUTED, weight: bv < pv - 1 ? 600 : 400, nums: true });
    });
  }
  save("fig12-bare.svg", svg(W, H, b));
}
