/**
 * Figure generator for EXFIL-PAPER.md. Emits self-contained SVGs into figures/.
 * The DETERMINISTIC figures (extraction curve, ruler divergence, aggregation) are
 * computed here from glove-egress (redteam + meter) and need no API. The
 * MODEL-IN-THE-LOOP figures (leak rate, bytes crossed, judge tier) read
 * results/exfil-results.json when present.
 *
 * Visual spec matches the main paper (figures.ts / frame-figures.ts): light
 * surface #fcfcfb, hairline grid, ink text, ≤46px rounded columns, direct value
 * labels, descriptive (non-conclusion-baking) titles. The arms get a fixed
 * categorical scale, separable by hue AND lightness: raw-mcp = clay (the leaky
 * default), repl = neutral gray, workflow = amber, gate = teal (the safe one).
 *
 *   npx tsx src/exfil-figures.ts   (or `pnpm exfil-figures`)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { simulateExtraction } from "glove-egress";
import { log2 } from "glove-egress";

const ROOT = join(import.meta.dirname, "..");
const RES = join(ROOT, "results");
const OUT = join(ROOT, "figures");
mkdirSync(OUT, { recursive: true });

// ── palette ────────────────────────────────────────────────────────────────────
const SURFACE = "#fcfcfb";
const INK = "#0b0b0b";
const INK2 = "#52514e";
const MUTED = "#898781";
const GRID = "#e1e0d9";
const BASE = "#c3c2b7";
const FONT = `system-ui, -apple-system, 'Segoe UI', sans-serif`;
const ARM_COLOR: Record<string, string> = {
  "raw-mcp": "#c0562f",
  repl: "#898781",
  workflow: "#d99a2b",
  gate: "#12887a",
  "self-judge": "#898781",
  "delegate-judge": "#12887a",
};
const ARM_LABEL: Record<string, string> = {
  "raw-mcp": "raw-mcp · tools folded",
  repl: "repl · execute_js",
  workflow: "workflow · voluntary",
  gate: "gate · enforced",
  "self-judge": "self-judge",
  "delegate-judge": "delegate-judge",
};
const ARMS_A = ["raw-mcp", "repl", "workflow", "gate"] as const;
const ARMS_B = ["self-judge", "delegate-judge"] as const;

// ── svg helpers ─────────────────────────────────────────────────────────────────
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function text(x: number, y: number, s: string, o: { size?: number; fill?: string; anchor?: string; weight?: number | string; nums?: boolean } = {}): string {
  const { size = 12, fill = INK2, anchor = "start", weight = 400, nums = false } = o;
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}"${nums ? ` font-variant-numeric="tabular-nums"` : ""}>${esc(s)}</text>`;
}
function column(x: number, yTop: number, w: number, h: number, fill: string, opacity = 1): string {
  if (h <= 0.5) return `<rect x="${x}" y="${yTop - 1}" width="${w}" height="2.5" fill="${fill}" opacity="0.7"/>`;
  const r = Math.min(4, h, w / 2);
  return `<path d="M ${x} ${yTop + h} L ${x} ${yTop + r} Q ${x} ${yTop} ${x + r} ${yTop} L ${x + w - r} ${yTop} Q ${x + w} ${yTop} ${x + w} ${yTop + r} L ${x + w} ${yTop + h} Z" fill="${fill}" opacity="${opacity}"/>`;
}
function grid(x0: number, x1: number, y: number): string {
  return `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`;
}
function svg(w: number, h: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img"><rect width="${w}" height="${h}" fill="${SURFACE}" rx="8"/>${body}</svg>`;
}
const save = (name: string, content: string) => { writeFileSync(join(OUT, name), content); console.log("wrote figures/" + name); };
const load = (f: string): any[] | null => (existsSync(join(RES, f)) ? JSON.parse(readFileSync(join(RES, f), "utf8")) : null);
const pct = (xs: any[], f: (r: any) => boolean) => (xs.length ? (xs.filter(f).length / xs.length) * 100 : 0);
const avg = (xs: any[], f: (r: any) => number) => (xs.length ? xs.reduce((a, r) => a + f(r), 0) / xs.length : 0);

function legend(x: number, y: number, arms: readonly string[], step = 168): string {
  return arms.map((a, i) => `<rect x="${x + i * step}" y="${y}" width="12" height="12" rx="3" fill="${ARM_COLOR[a]}"/>` + text(x + i * step + 18, y + 11, ARM_LABEL[a], { size: 11.5, fill: INK2 })).join("");
}

// ══ Fig 1 — headline: leak rate + task pass by arm (Experiment A) ═════════════
function figHeadline(rows: any[]) {
  const A = rows.filter((r) => r.experiment === "A");
  const W = 760, H = 380;
  const M = { l: 16, r: 16, t: 96, b: 92 };
  const panels: Array<{ label: string; get: (arm: string) => number; max: number; fmt: (v: number) => string }> = [
    { label: "Canary leak rate", get: (arm) => pct(A.filter((r) => r.arm === arm), (r) => r.leakedTarget), max: 100, fmt: (v) => `${Math.round(v)}%` },
    { label: "Task pass rate", get: (arm) => pct(A.filter((r) => r.arm === arm), (r) => r.taskPass), max: 100, fmt: (v) => `${Math.round(v)}%` },
  ];
  let b = text(16, 30, "The leak only closes when the boundary is enforced — not when the model is merely asked", { size: 14.5, fill: INK, weight: 600 });
  b += text(16, 48, "Same canary-salted org · leak = the exact secret reached the planner's context or the outbox · task pass held alongside", { size: 12, fill: INK2 });
  b += legend(16, 66, ARMS_A);
  const inner = W - M.l - M.r, gap = 44;
  const gw = (inner - gap) / 2, ph = H - M.t - M.b;
  panels.forEach((p, pi) => {
    const gx = M.l + pi * (gw + gap), yb = M.t + ph;
    const y = (v: number) => yb - (v / p.max) * ph;
    for (let q = 1; q <= 4; q++) b += grid(gx, gx + gw, yb - (q / 4) * ph);
    b += `<line x1="${gx}" y1="${yb}" x2="${gx + gw}" y2="${yb}" stroke="${BASE}" stroke-width="1"/>`;
    const bw = Math.min(60, (gw - 30) / 4 - 10);
    const cluster = bw * 4 + 12 * 3, sx = gx + (gw - cluster) / 2;
    ARMS_A.forEach((arm, i) => {
      const v = p.get(arm), x = sx + i * (bw + 12);
      b += column(x, y(v), bw, yb - y(v), ARM_COLOR[arm]);
      b += text(x + bw / 2, y(v) - 6, p.fmt(v), { size: 11.5, fill: INK, anchor: "middle", weight: 600, nums: true });
      b += text(x + bw / 2, yb + 16, arm, { size: 10, fill: INK2, anchor: "middle" });
    });
    b += text(gx + gw / 2, yb + 42, p.label, { size: 13, fill: INK, anchor: "middle", weight: 600 });
  });
  save("fig-exfil-headline.svg", svg(W, H, b));
}

// ══ Fig 2 — SECRET bits crossed (the operational leakage, min-entropy sense) ══
function figLeakBits(rows: any[]) {
  const A = rows.filter((r) => r.experiment === "A");
  const W = 760, H = 320;
  const M = { l: 44, r: 20, t: 84, b: 52 };
  const pw = W - M.l - M.r, ph = H - M.t - M.b;
  const vals = ARMS_A.map((arm) => ({ arm, bits: avg(A.filter((r) => r.arm === arm), (r) => r.secretBitsRecovered) }));
  const max = Math.max(1, ...vals.map((v) => v.bits)) * 1.18;
  let b = text(16, 30, "Secret bits crossing the boundary per task — the operational leakage, not the raw byte count", { size: 14.5, fill: INK, weight: 600 });
  b += text(16, 48, "Bits of the exact canary recovered from the planner's context or outbox, averaged over Experiment A · discipline lowers it; only enforcement reaches 0", { size: 11.5, fill: INK2 });
  const y = (v: number) => M.t + ph - (v / max) * ph;
  for (let q = 0; q <= 4; q++) {
    const gv = (max / 4) * q;
    b += grid(M.l, M.l + pw, y(gv));
    b += text(M.l - 8, y(gv) + 4, gv.toFixed(0), { size: 10.5, fill: MUTED, anchor: "end", nums: true });
  }
  const bw = Math.min(96, pw / vals.length - 40);
  vals.forEach((v, i) => {
    const x = M.l + (i + 0.5) * (pw / vals.length) - bw / 2;
    b += column(x, y(v.bits), bw, M.t + ph - y(v.bits), ARM_COLOR[v.arm]);
    b += text(x + bw / 2, y(v.bits) - 8, v.bits.toFixed(0), { size: 12, fill: INK, anchor: "middle", weight: 600, nums: true });
    b += text(x + bw / 2, M.t + ph + 20, v.arm, { size: 12, fill: INK2, anchor: "middle", weight: 600 });
  });
  save("fig-exfil-leakbits.svg", svg(W, H, b));
}

// ══ Fig 3 — per scenario × arm leak heatmap ═══════════════════════════════════
function figScenario(rows: any[]) {
  const A = rows.filter((r) => r.experiment === "A");
  const scens = [...new Set(A.map((r) => r.scenario))];
  const W = 760, H = 96 + scens.length * 52 + 40;
  const M = { l: 210, t: 96 };
  const cw = (W - M.l - 24) / ARMS_A.length;
  let b = text(16, 30, "Where each discipline leaks — leak rate by task and arm", { size: 14.5, fill: INK, weight: 600 });
  b += text(16, 48, "Darker = higher leak rate. Temptation tasks tempt a raw dump; the injection task (open-prs) also checks the outbox.", { size: 12, fill: INK2 });
  ARMS_A.forEach((arm, i) => b += text(M.l + (i + 0.5) * cw, 82, arm, { size: 11.5, fill: INK, anchor: "middle", weight: 600 }));
  scens.forEach((s, si) => {
    const y = M.t + si * 52;
    const kind = A.find((r) => r.scenario === s)?.kind ?? "";
    b += text(16, y + 30, s, { size: 12, fill: INK, weight: 600 });
    b += text(16, y + 45, `(${kind})`, { size: 10.5, fill: MUTED });
    ARMS_A.forEach((arm, i) => {
      const g = A.filter((r) => r.arm === arm && r.scenario === s);
      const leak = pct(g, (r) => r.leakedTarget) / 100;
      const x = M.l + i * cw;
      const col = ARM_COLOR[arm];
      b += `<rect x="${x + 4}" y="${y + 8}" width="${cw - 8}" height="40" rx="5" fill="${col}" opacity="${(0.12 + 0.85 * leak).toFixed(3)}"/>`;
      b += text(x + cw / 2, y + 33, g.length ? `${Math.round(leak * 100)}%` : "—", { size: 13, fill: leak > 0.45 ? "#fff" : INK, anchor: "middle", weight: 700, nums: true });
    });
  });
  save("fig-exfil-scenario.svg", svg(W, H, b));
}

// ══ Fig 4 — adaptive extraction curve + bit budget (DETERMINISTIC) ════════════
function figExtraction() {
  const W = 760, H = 380;
  const M = { l: 58, r: 140, t: 92, b: 54 };
  const pw = W - M.l - M.r, ph = H - M.t - M.b;
  const N = 1024;
  const full = simulateExtraction({ N, secret: 733, strategy: "binary" });
  const budgeted = simulateExtraction({ N, secret: 733, strategy: "binary", budgetBits: 4 });
  const maxQ = Math.max(full.queries, budgeted.queries) + 1;
  const maxBits = log2(N);
  const x = (q: number) => M.l + (q / maxQ) * pw;
  const y = (bits: number) => M.t + ph - (bits / maxBits) * ph;
  let b = text(16, 30, "A boolean channel is not safe just because each answer is one bit", { size: 14.5, fill: INK, weight: 600 });
  b += text(16, 48, "Adaptive binary search extracts a secret from a 1024-value space in ~log₂N=10 queries · a 4-bit session budget halts it early", { size: 12, fill: INK2 });
  for (let q = 0; q <= 4; q++) {
    const gb = (maxBits / 4) * q;
    b += grid(M.l, M.l + pw, y(gb));
    b += text(M.l - 8, y(gb) + 4, `${gb.toFixed(0)}`, { size: 10.5, fill: MUTED, anchor: "end", nums: true });
  }
  b += text(16, M.t - 8, "min-entropy leaked (bits)", { size: 11, fill: INK2 });
  b += text(M.l + pw / 2, M.t + ph + 40, "adaptive queries", { size: 12, fill: INK2, anchor: "middle" });
  for (let q = 0; q <= maxQ; q += 2) b += text(x(q), M.t + ph + 20, String(q), { size: 10, fill: MUTED, anchor: "middle", nums: true });
  // budget line
  b += `<line x1="${M.l}" y1="${y(4)}" x2="${M.l + pw}" y2="${y(4)}" stroke="${ARM_COLOR.gate}" stroke-width="1.5" stroke-dasharray="5 4"/>`;
  b += text(M.l + pw + 8, y(4) + 4, "4-bit budget", { size: 11, fill: ARM_COLOR.gate, weight: 600 });
  // unbounded extraction curve
  const line = (steps: any[], color: string) => {
    const pts = [`M ${x(0)} ${y(0)}`, ...steps.map((s) => `L ${x(s.q)} ${y(s.minEntLeak)}`)];
    return `<path d="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="2.4"/>` + steps.map((s) => `<circle cx="${x(s.q)}" cy="${y(s.minEntLeak)}" r="3" fill="${color}"/>`).join("");
  };
  b += line(full.steps, ARM_COLOR["raw-mcp"]);
  b += line(budgeted.steps.filter((s) => !s.budgetHalted), "#2a78d6");
  // annotate recovery
  const last = full.steps[full.steps.length - 1];
  b += text(x(last.q) + 6, y(last.minEntLeak) + 2, "secret pinned", { size: 11, fill: ARM_COLOR["raw-mcp"], weight: 600 });
  const halt = budgeted.steps.find((s) => s.budgetHalted);
  if (halt) b += text(x(halt.q) + 6, y(4) - 8, `halted · ${budgeted.residualSupport} candidates remain`, { size: 10.5, fill: "#2a78d6" });
  b += `<rect x="${M.l + pw + 8}" y="${M.t + 30}" width="12" height="12" rx="3" fill="${ARM_COLOR["raw-mcp"]}"/>` + text(M.l + pw + 24, M.t + 40, "unbounded", { size: 11, fill: INK2 });
  b += `<rect x="${M.l + pw + 8}" y="${M.t + 50}" width="12" height="12" rx="3" fill="#2a78d6"/>` + text(M.l + pw + 24, M.t + 60, "budgeted", { size: 11, fill: INK2 });
  save("fig-exfil-extraction.svg", svg(W, H, b));
}

// ══ Fig 5 — Shannon vs min-entropy: the ruler matters (DETERMINISTIC) ═════════
function figRulers() {
  const W = 760, H = 360;
  const M = { l: 60, r: 20, t: 96, b: 60 };
  const pw = W - M.l - M.r, ph = H - M.t - M.b;
  const N = 10000;
  const qs = [0.01, 0.05, 0.1, 0.25, 0.5];
  // "sometimes reveals everything" channel: Shannon = q·log2N; min-ent = log2(Vpost/Vprior)
  const data = qs.map((q) => {
    const shannon = q * log2(N);
    const Vpost = q + (1 - q) / N;
    const minEnt = log2(Vpost / (1 / N));
    return { q, shannon, minEnt };
  });
  const max = Math.max(...data.map((d) => Math.max(d.shannon, d.minEnt))) * 1.12;
  let b = text(16, 30, "Shannon averages a catastrophic reveal away; min-entropy does not — pick the security ruler", { size: 14.5, fill: INK, weight: 600 });
  b += text(16, 48, "A channel that with probability q leaks the whole secret (|S|=10 000). Shannon 'bits crossed' stays tiny; min-entropy leakage tracks the real one-guess risk.", { size: 11.5, fill: INK2 });
  b += `<rect x="16" y="64" width="12" height="12" rx="3" fill="${MUTED}"/>` + text(34, 75, "Shannon I(S;O) — throughput headline", { size: 11.5, fill: INK2 });
  b += `<rect x="330" y="64" width="12" height="12" rx="3" fill="${ARM_COLOR["raw-mcp"]}"/>` + text(348, 75, "min-entropy leakage — one-guess risk", { size: 11.5, fill: INK2 });
  const y = (v: number) => M.t + ph - (v / max) * ph;
  for (let q = 0; q <= 4; q++) {
    const gv = (max / 4) * q;
    b += grid(M.l, M.l + pw, y(gv));
    b += text(M.l - 8, y(gv) + 4, gv.toFixed(0), { size: 10.5, fill: MUTED, anchor: "end", nums: true });
  }
  b += text(M.l + pw / 2, M.t + ph + 40, "q = P(channel reveals the secret)", { size: 12, fill: INK2, anchor: "middle" });
  const gwCol = pw / data.length;
  data.forEach((d, i) => {
    const cx = M.l + (i + 0.5) * gwCol;
    const bw = 40;
    b += column(cx - bw - 3, y(d.shannon), bw, M.t + ph - y(d.shannon), MUTED);
    b += text(cx - bw / 2 - 3, y(d.shannon) - 6, d.shannon.toFixed(1), { size: 10, fill: INK, anchor: "middle", nums: true });
    b += column(cx + 3, y(d.minEnt), bw, M.t + ph - y(d.minEnt), ARM_COLOR["raw-mcp"]);
    b += text(cx + bw / 2 + 3, y(d.minEnt) - 6, d.minEnt.toFixed(1), { size: 10, fill: INK, anchor: "middle", nums: true });
    b += text(cx, M.t + ph + 20, d.q.toFixed(2), { size: 11, fill: INK2, anchor: "middle", nums: true });
  });
  save("fig-exfil-rulers.svg", svg(W, H, b));
}

// ══ Fig 6 — judge tier: accuracy vs bytes crossed (Experiment B) ══════════════
function figJudge(rows: any[]) {
  const B = rows.filter((r) => r.experiment === "B");
  if (!B.length) return;
  const W = 760, H = 340;
  const M = { l: 16, r: 16, t: 92, b: 84 };
  const panels: Array<{ label: string; get: (arm: string) => number; max: number; fmt: (v: number) => string }> = [
    { label: "Judge accuracy", get: (arm) => pct(B.filter((r) => r.arm === arm), (r) => r.taskPass), max: 100, fmt: (v) => `${Math.round(v)}%` },
    { label: "Canary (PII) leak rate", get: (arm) => pct(B.filter((r) => r.arm === arm), (r) => r.leakedTarget), max: 100, fmt: (v) => `${Math.round(v)}%` },
    { label: "Delegated classify calls", get: (arm) => avg(B.filter((r) => r.arm === arm), (r) => r.judgeCalls ?? 0), max: Math.max(1, ...ARMS_B.map((a) => avg(B.filter((r) => r.arm === a), (r) => r.judgeCalls ?? 0))) * 1.25, fmt: (v) => v.toFixed(1) },
  ];
  let b = text(16, 30, "Delegating the judgement keeps accuracy while the documents never reach the planner", { size: 14.5, fill: INK, weight: 600 });
  b += text(16, 48, "Subjective 'how many are negative?' over a feedback corpus with a PII canary · the planner sees only booleans", { size: 11.5, fill: INK2 });
  b += legend(16, 66, ARMS_B, 150);
  const inner = W - M.l - M.r, gap = 36, gw = (inner - gap * 2) / 3, ph = H - M.t - M.b;
  panels.forEach((p, pi) => {
    const gx = M.l + pi * (gw + gap), yb = M.t + ph;
    const y = (v: number) => yb - (v / p.max) * ph;
    for (let q = 1; q <= 4; q++) b += grid(gx, gx + gw, yb - (q / 4) * ph);
    b += `<line x1="${gx}" y1="${yb}" x2="${gx + gw}" y2="${yb}" stroke="${BASE}" stroke-width="1"/>`;
    const bw = Math.min(56, (gw - 20) / 2 - 10), cluster = bw * 2 + 14, sx = gx + (gw - cluster) / 2;
    ARMS_B.forEach((arm, i) => {
      const v = p.get(arm), x = sx + i * (bw + 14);
      b += column(x, y(v), bw, yb - y(v), ARM_COLOR[arm]);
      b += text(x + bw / 2, y(v) - 6, p.fmt(v), { size: 11, fill: INK, anchor: "middle", weight: 600, nums: true });
    });
    b += text(gx + gw / 2, yb + 22, p.label, { size: 12.5, fill: INK, anchor: "middle", weight: 600 });
  });
  save("fig-exfil-judge.svg", svg(W, H, b));
}

// ── main ─────────────────────────────────────────────────────────────────────
figExtraction();
figRulers();
const rows = load("exfil-results.json");
if (rows && rows.length) {
  figHeadline(rows);
  figLeakBits(rows);
  figScenario(rows);
  figJudge(rows);
} else {
  console.log("(no results/exfil-results.json yet — deterministic figures only)");
}
