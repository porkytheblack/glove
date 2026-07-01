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
