/**
 * Figure generator for FRAME-PAPER.md — reads the frame-bench + frame-choice
 * results (results/frames-*.json) and emits self-contained SVG figures into
 * figures/. No dependencies; run: npx tsx src/frame-figures.ts (or `pnpm frame-figures`).
 *
 * Visual spec matches the main paper's figures.ts (dataviz method): light surface
 * #fcfcfb, hairline grid #e1e0d9, ink tokens for text, ≤46px columns with 4px
 * rounded data-ends, selective direct labels. The three framings get a fixed,
 * grayscale-separable categorical trio (repl = neutral gray as the status-quo
 * default, program = blue, workflow = teal). Titles are descriptive, not
 * conclusion-baking — the prose in the paper carries the interpretation.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const RES = join(ROOT, "results");
const OUT = join(ROOT, "figures");
mkdirSync(OUT, { recursive: true });

// ── palette (matches figures.ts) ──────────────────────────────────────────────
const SURFACE = "#fcfcfb";
const INK = "#0b0b0b";
const INK2 = "#52514e";
const MUTED = "#898781";
const GRID = "#e1e0d9";
const BASE = "#c3c2b7";
const FONT = `system-ui, -apple-system, 'Segoe UI', sans-serif`;
// Frame trio — separable by hue AND lightness (grayscale-safe).
const FRAME_COLOR: Record<string, string> = { repl: "#898781", program: "#2a78d6", workflow: "#12887a" };
const FRAME_LABEL: Record<string, string> = { repl: "repl · execute_js", program: "program · _program", workflow: "workflow · _workflow" };
const FRAMES = ["repl", "program", "workflow"] as const;
type Frame = (typeof FRAMES)[number];

// ── svg helpers ───────────────────────────────────────────────────────────────
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function text(x: number, y: number, s: string, o: { size?: number; fill?: string; anchor?: string; weight?: number | string; nums?: boolean } = {}): string {
  const { size = 12, fill = INK2, anchor = "start", weight = 400, nums = false } = o;
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}"${nums ? ` font-variant-numeric="tabular-nums"` : ""}>${esc(s)}</text>`;
}
function column(x: number, yTop: number, w: number, h: number, fill: string): string {
  if (h <= 0.5) return `<rect x="${x}" y="${yTop - 1}" width="${w}" height="2" fill="${fill}" opacity="0.55"/>`;
  const r = Math.min(4, h, w / 2);
  return `<path d="M ${x} ${yTop + h} L ${x} ${yTop + r} Q ${x} ${yTop} ${x + r} ${yTop} L ${x + w - r} ${yTop} Q ${x + w} ${yTop} ${x + w} ${yTop + r} L ${x + w} ${yTop + h} Z" fill="${fill}"/>`;
}
function grid(x0: number, x1: number, y: number): string {
  return `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`;
}
function svg(w: number, h: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img"><rect width="${w}" height="${h}" fill="${SURFACE}" rx="8"/>${body}</svg>`;
}
const save = (name: string, content: string) => { writeFileSync(join(OUT, name), content); console.log("wrote figures/" + name); };
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);
const load = (f: string): any[] | null => (existsSync(join(RES, f)) ? JSON.parse(readFileSync(join(RES, f), "utf8")) : null);

interface Row { modelKey: string; scenario: string; frameName: string; ok: boolean; evalCalls: number; singleCall: boolean; turns: number; }
function frameAgg(rows: Row[], f: Frame) {
  const g = rows.filter((r) => r.frameName === f);
  const n = g.length || 1;
  return {
    n: g.length,
    pass: g.filter((r) => r.ok).length / n,
    single: g.filter((r) => r.singleCall).length / n,
    evalAvg: g.reduce((s, r) => s + r.evalCalls, 0) / n,
    evalMed: median(g.map((r) => r.evalCalls)),
    turns: g.reduce((s, r) => s + r.turns, 0) / n,
  };
}
function legend(x: number, y: number, step = 178): string {
  return FRAMES.map((f, i) => `<rect x="${x + i * step}" y="${y}" width="12" height="12" rx="3" fill="${FRAME_COLOR[f]}"/>` + text(x + i * step + 18, y + 11, FRAME_LABEL[f], { size: 12, fill: INK2 })).join("");
}

/** A row of small metric panels; each panel is a cluster of the three framings,
 *  with quartile gridlines and direct value labels. */
function groupedPanel(
  x0: number, y0: number, w: number, h: number,
  metrics: Array<{ label: string; vals: Record<Frame, number>; max: number; fmt: (v: number) => string }>,
): string {
  const M = { l: 12, r: 12, t: 10, b: 44 };
  const ph = h - M.t - M.b;
  const inner = w - M.l - M.r;
  const gap = 26;
  const gw = (inner - gap * (metrics.length - 1)) / metrics.length;
  let b = "";
  metrics.forEach((m, mi) => {
    const gx = x0 + M.l + mi * (gw + gap);
    const yb = y0 + M.t + ph;
    const y = (v: number) => yb - (v / m.max) * ph;
    for (let q = 1; q <= 4; q++) b += grid(gx, gx + gw, yb - (q / 4) * ph);
    b += `<line x1="${gx}" y1="${yb}" x2="${gx + gw}" y2="${yb}" stroke="${BASE}" stroke-width="1"/>`;
    const bw = Math.min(46, (gw - 20) / 3 - 8);
    const cluster = bw * 3 + 8 * 2;
    const sx = gx + (gw - cluster) / 2;
    FRAMES.forEach((f, fi) => {
      const v = m.vals[f];
      const x = sx + fi * (bw + 8);
      b += column(x, y(v), bw, yb - y(v), FRAME_COLOR[f]);
      b += text(x + bw / 2, y(v) - 6, m.fmt(v), { size: 11, fill: INK, anchor: "middle", weight: 600, nums: true });
    });
    b += text(gx + gw / 2, yb + 22, m.label, { size: 12.5, fill: INK, anchor: "middle", weight: 600 });
  });
  return b;
}

// ══ Fig A — headline: single-call, pass, eval calls by frame ══════════════════
function figHeadline(rows: Row[], file: string, sub: string) {
  const W = 760, H = 360;
  const vals = (sel: (a: ReturnType<typeof frameAgg>) => number) => Object.fromEntries(FRAMES.map((f) => [f, sel(frameAgg(rows, f))])) as Record<Frame, number>;
  const maxEval = Math.max(4, ...FRAMES.map((f) => frameAgg(rows, f).evalAvg)) * 1.18;
  let b = text(16, 28, "Renaming the eval tool shifts single-call rate, correctness, and calls per task", { size: 14.5, fill: INK, weight: 600 });
  b += text(16, 46, sub, { size: 12, fill: INK2 });
  b += legend(16, 62);
  b += groupedPanel(0, 88, W, H - 88, [
    { label: "Single-call rate", vals: vals((a) => a.single * 100), max: 100, fmt: (v) => `${Math.round(v)}%` },
    { label: "Pass rate", vals: vals((a) => a.pass * 100), max: 100, fmt: (v) => `${Math.round(v)}%` },
    { label: "Avg eval calls / task", vals: vals((a) => a.evalAvg), max: maxEval, fmt: (v) => v.toFixed(1) },
  ]);
  save(file, svg(W, H, b));
}

// ══ Fig B — per-model single-call rate by frame ═══════════════════════════════
function figPerModel(rows: Row[], file: string) {
  const models = [...new Set(rows.map((r) => r.modelKey))];
  const W = 760, H = 330;
  const M = { l: 46, r: 16, t: 92, b: 52 };
  const pw = W - M.l - M.r, ph = H - M.t - M.b;
  const y = (pct: number) => M.t + ph - (pct / 100) * ph;
  let b = text(16, 28, "Single-call rate by model and frame — the effect is model-dependent", { size: 14.5, fill: INK, weight: 600 });
  b += text(16, 46, "Share of runs that did the whole task in exactly one eval call · higher = composes one program, not a session", { size: 12, fill: INK2 });
  b += legend(16, 64);
  for (const t of [0, 25, 50, 75, 100]) { b += grid(M.l, W - M.r, y(t)); b += text(M.l - 8, y(t) + 4, `${t}%`, { size: 11, fill: MUTED, anchor: "end", nums: true }); }
  const slot = pw / models.length, bw = Math.min(30, slot / 4.2);
  models.forEach((mk, i) => {
    const cx = M.l + i * slot + slot / 2;
    const cluster = bw * 3 + 7 * 2;
    FRAMES.forEach((f, fi) => {
      const a = frameAgg(rows.filter((r) => r.modelKey === mk), f);
      const x = cx - cluster / 2 + fi * (bw + 7);
      b += column(x, y(a.single * 100), bw, ph - (y(a.single * 100) - M.t), FRAME_COLOR[f]);
      b += text(x + bw / 2, y(a.single * 100) - 5, `${Math.round(a.single * 100)}`, { size: 9.5, fill: INK2, anchor: "middle", nums: true });
    });
    b += text(cx, M.t + ph + 22, mk, { size: 12, fill: INK, anchor: "middle", weight: 600 });
  });
  b += `<line x1="${M.l}" y1="${M.t + ph}" x2="${W - M.r}" y2="${M.t + ph}" stroke="${BASE}" stroke-width="1"/>`;
  save(file, svg(W, H, b));
}

// ══ Fig C — discovery mode: single-call by frame, full vs progressive ═════════
function figDiscovery(full: Row[], prog: Row[], file: string) {
  const W = 620, H = 330;
  const M = { l: 46, r: 16, t: 90, b: 52 };
  const pw = W - M.l - M.r, ph = H - M.t - M.b;
  const y = (pct: number) => M.t + ph - (pct / 100) * ph;
  let b = text(16, 28, "Single-call rate by frame — shapes primed vs discover-from-scratch", { size: 14.5, fill: INK, weight: 600 });
  b += text(16, 46, "The de-REPL framings pull hardest when nothing is primed and a REPL would peek-then-split", { size: 12, fill: INK2 });
  b += legend(16, 64, 150);
  for (const t of [0, 25, 50, 75, 100]) { b += grid(M.l, W - M.r, y(t)); b += text(M.l - 8, y(t) + 4, `${t}%`, { size: 11, fill: MUTED, anchor: "end", nums: true }); }
  const groups = [{ label: "full (shapes primed)", rows: full }, { label: "progressive (discover)", rows: prog }];
  const slot = pw / groups.length, bw = Math.min(38, slot / 4.5);
  groups.forEach((gp, i) => {
    const cx = M.l + i * slot + slot / 2;
    const cluster = bw * 3 + 9 * 2;
    FRAMES.forEach((f, fi) => {
      const a = frameAgg(gp.rows, f);
      const x = cx - cluster / 2 + fi * (bw + 9);
      b += column(x, y(a.single * 100), bw, ph - (y(a.single * 100) - M.t), FRAME_COLOR[f]);
      b += text(x + bw / 2, y(a.single * 100) - 6, `${Math.round(a.single * 100)}`, { size: 10.5, fill: INK, anchor: "middle", weight: 600, nums: true });
    });
    b += text(cx, M.t + ph + 22, gp.label, { size: 12, fill: INK, anchor: "middle", weight: 600 });
  });
  b += `<line x1="${M.l}" y1="${M.t + ph}" x2="${W - M.r}" y2="${M.t + ph}" stroke="${BASE}" stroke-width="1"/>`;
  save(file, svg(W, H, b));
}

// ══ Fig D — revealed preference: which name the model uses ═════════════════════
interface ChoiceRow { modelKey: string; order: string; pick: Frame | null; }
function figChoice(rows: ChoiceRow[], file: string) {
  const W = 760, H = 340;
  const M = { l: 46, r: 16, t: 96, b: 56 };
  const pw = W - M.l - M.r, ph = H - M.t - M.b;
  const y = (pct: number) => M.t + ph - (pct / 100) * ph;
  const share = (rs: ChoiceRow[]) => {
    const p = rs.filter((r) => r.pick);
    const c = { repl: 0, program: 0, workflow: 0 } as Record<Frame, number>;
    for (const r of p) c[r.pick as Frame]++;
    return { n: p.length, share: Object.fromEntries(FRAMES.map((f) => [f, p.length ? (100 * c[f]) / p.length : 0])) as Record<Frame, number> };
  };
  let b = text(16, 28, "Revealed preference: which of three identically-behaving eval tools the model uses", { size: 14.5, fill: INK, weight: 600 });
  b += text(16, 46, "All three mounted at once · byte-identical descriptions · only the NAME differs · presentation order counterbalanced", { size: 12, fill: INK2 });
  b += text(16, 62, "Share of runs (with ≥1 eval call) whose most-used tool was each name", { size: 11, fill: MUTED });
  b += legend(16, 76);
  for (const t of [0, 25, 50, 75, 100]) { b += grid(M.l, W - M.r, y(t)); b += text(M.l - 8, y(t) + 4, `${t}%`, { size: 11, fill: MUTED, anchor: "end", nums: true }); }
  const groups = [
    { label: "all runs", rows },
    { label: "order A (repl-first)", rows: rows.filter((r) => r.order === "A") },
    { label: "order B (workflow-first)", rows: rows.filter((r) => r.order === "B") },
  ];
  const slot = pw / groups.length, bw = Math.min(32, slot / 4.2);
  groups.forEach((gp, i) => {
    const s = share(gp.rows);
    const cx = M.l + i * slot + slot / 2;
    const cluster = bw * 3 + 7 * 2;
    FRAMES.forEach((f, fi) => {
      const x = cx - cluster / 2 + fi * (bw + 7);
      b += column(x, y(s.share[f]), bw, ph - (y(s.share[f]) - M.t), FRAME_COLOR[f]);
      b += text(x + bw / 2, y(s.share[f]) - 6, `${Math.round(s.share[f])}`, { size: 10.5, fill: INK, anchor: "middle", weight: 600, nums: true });
    });
    b += text(cx, M.t + ph + 22, gp.label, { size: 11.5, fill: INK, anchor: "middle", weight: 600 });
    b += text(cx, M.t + ph + 38, `n=${s.n}`, { size: 10.5, fill: MUTED, anchor: "middle", nums: true });
  });
  b += `<line x1="${M.l}" y1="${M.t + ph}" x2="${W - M.r}" y2="${M.t + ph}" stroke="${BASE}" stroke-width="1"/>`;
  save(file, svg(W, H, b));
}

// ══ Fig E — dual surface: identical descriptions vs distinct roles ════════════
interface UsageRow { chose: { repl: number; program: number; workflow: number }; }
function figDual(identical: UsageRow[], roles: UsageRow[], file: string) {
  const W = 720, H = 348;
  const M = { l: 46, r: 16, t: 96, b: 56 };
  const pw = W - M.l - M.r, ph = H - M.t - M.b;
  const y = (pct: number) => M.t + ph - (pct / 100) * ph;
  const usage = (rs: UsageRow[]) => {
    const n = rs.length || 1;
    return {
      workflow: (100 * rs.filter((r) => r.chose.workflow > 0).length) / n,
      repl: (100 * rs.filter((r) => r.chose.repl > 0).length) / n,
      both: (100 * rs.filter((r) => r.chose.repl > 0 && r.chose.workflow > 0).length) / n,
      n: rs.length,
    };
  };
  // series colors: workflow=teal, execute_js=gray, both=blue
  const SERIES = [
    { key: "workflow" as const, label: "used execute_js_workflow", color: FRAME_COLOR.workflow },
    { key: "repl" as const, label: "used execute_js", color: FRAME_COLOR.repl },
    { key: "both" as const, label: "used both", color: FRAME_COLOR.program },
  ];
  let b = text(16, 28, "Told they are the same, the model avoids workflow; told they differ, it routes to it", { size: 14.5, fill: INK, weight: 600 });
  b += text(16, 46, "execute_js + execute_js_workflow mounted together · which surface each run used · 6 complex tasks × 4 models", { size: 12, fill: INK2 });
  b += SERIES.map((s, i) => `<rect x="${16 + i * 210}" y="62" width="12" height="12" rx="3" fill="${s.color}"/>` + text(16 + i * 210 + 18, 73, s.label, { size: 12, fill: INK2 })).join("");
  for (const t of [0, 25, 50, 75, 100]) { b += grid(M.l, W - M.r, y(t)); b += text(M.l - 8, y(t) + 4, `${t}%`, { size: 11, fill: MUTED, anchor: "end", nums: true }); }
  const groups = [
    { label: "identical descriptions", u: usage(identical) },
    { label: "distinct roles (explore vs do)", u: usage(roles) },
  ];
  const slot = pw / groups.length, bw = Math.min(40, slot / 4.5);
  groups.forEach((gp, i) => {
    const cx = M.l + i * slot + slot / 2;
    const cluster = bw * 3 + 9 * 2;
    SERIES.forEach((s, si) => {
      const v = gp.u[s.key];
      const x = cx - cluster / 2 + si * (bw + 9);
      b += column(x, y(v), bw, ph - (y(v) - M.t), s.color);
      b += text(x + bw / 2, y(v) - 6, `${Math.round(v)}`, { size: 10.5, fill: INK, anchor: "middle", weight: 600, nums: true });
    });
    b += text(cx, M.t + ph + 22, gp.label, { size: 12, fill: INK, anchor: "middle", weight: 600 });
    b += text(cx, M.t + ph + 38, `n=${gp.u.n}`, { size: 10.5, fill: MUTED, anchor: "middle", nums: true });
  });
  b += `<line x1="${M.l}" y1="${M.t + ph}" x2="${W - M.r}" y2="${M.t + ph}" stroke="${BASE}" stroke-width="1"/>`;
  save(file, svg(W, H, b));
}

// ── drive ─────────────────────────────────────────────────────────────────────
const complex = load("frames-js2-results.json") as Row[] | null;
const easyFull = load("frames-js-results.json") as Row[] | null;
const prog = load("frames-js-prog-results.json") as Row[] | null;
const choice = load("frames-choice-results.json") as ChoiceRow[] | null;

const primary = complex ?? easyFull;
if (primary) {
  const nModels = new Set(primary.map((r) => r.modelKey)).size;
  const nScen = new Set(primary.map((r) => r.scenario)).size;
  const kind = complex ? "complex" : "cross-service";
  figHeadline(primary, "fig-frame-headline.svg", `${nScen} ${kind} tasks × ${nModels} models · same runtime/catalog/scenarios — only the tool's name + priming differ`);
  figPerModel(primary, "fig-frame-permodel.svg");
}
// Discovery-mode contrast: full vs progressive on the SAME scenario set (the ones
// the progressive run covers), so the only variable is whether shapes are primed.
if (easyFull && prog) {
  const progScen = new Set(prog.map((r) => r.scenario));
  figDiscovery(easyFull.filter((r) => progScen.has(r.scenario)), prog, "fig-frame-discovery.svg");
}
if (choice) figChoice(choice, "fig-frame-choice.svg");
const dual = load("frames-dual-results.json") as UsageRow[] | null;
if (choice && dual) figDual(choice as unknown as UsageRow[], dual, "fig-frame-dual.svg");

console.log("frame figures written to figures/ " + (complex ? "(complex A/B)" : easyFull ? "(easy A/B fallback)" : "(no A/B data yet)"));
