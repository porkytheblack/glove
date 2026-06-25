/**
 * Deterministic fake data for the two dummy MCP servers.
 *
 * Seeded so the payloads — and therefore the byte counts and the final answer —
 * are stable across runs. This is the kind of data a real issue tracker and CRM
 * would hand back: big, flat-ish JSON arrays that bloat a model's context if you
 * drag the whole thing through it.
 */

// ─── Seeded PRNG (mulberry32) ────────────────────────────────────────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

function weighted<T>(rng: () => number, table: readonly [T, number][]): T {
  const total = table.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [val, w] of table) {
    if ((r -= w) <= 0) return val;
  }
  return table[table.length - 1]![0];
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

// ─── CRM accounts ────────────────────────────────────────────────────────────

export interface Account {
  account_id: string;
  name: string;
  tier: "enterprise" | "growth" | "startup";
  arr: number; // annual recurring revenue, USD
  region: "NA" | "EU" | "APAC" | "LATAM";
  seats: number;
  csm: string; // customer success manager
  renewal_date: string;
  health: "green" | "yellow" | "red";
}

const COMPANY_HEADS = [
  "Acme", "Globex", "Initech", "Umbrella", "Hooli", "Stark", "Wayne", "Wonka",
  "Soylent", "Vandelay", "Pied Piper", "Cyberdyne", "Tyrell", "Massive Dynamic",
  "Gekko", "Nakatomi", "Oscorp", "Aperture", "BlueSun", "Weyland",
];
const COMPANY_TAILS = ["Corp", "Labs", "Industries", "Systems", "Group", "Holdings", "Technologies", "Partners"];
const REGIONS = ["NA", "EU", "APAC", "LATAM"] as const;

export function generateAccounts(count: number, seed = 0xACC): Account[] {
  const rng = mulberry32(seed);
  return Array.from({ length: count }, (_, i) => {
    const tier = weighted(rng, [
      ["enterprise", 0.2],
      ["growth", 0.4],
      ["startup", 0.4],
    ] as const);
    const arr =
      tier === "enterprise"
        ? 80_000 + Math.floor(rng() * 420_000)
        : tier === "growth"
          ? 15_000 + Math.floor(rng() * 65_000)
          : 2_000 + Math.floor(rng() * 13_000);
    const seats =
      tier === "enterprise" ? 50 + Math.floor(rng() * 950) : 3 + Math.floor(rng() * 80);
    const month = 1 + Math.floor(rng() * 12);
    const day = 1 + Math.floor(rng() * 28);
    return {
      account_id: `ACC-${pad(i + 1, 4)}`,
      name: `${pick(rng, COMPANY_HEADS)} ${pick(rng, COMPANY_TAILS)}`,
      tier,
      arr,
      region: pick(rng, REGIONS),
      seats,
      csm: `csm-${1 + Math.floor(rng() * 12)}`,
      renewal_date: `2026-${pad(month, 2)}-${pad(day, 2)}`,
      health: weighted(rng, [
        ["green", 0.6],
        ["yellow", 0.3],
        ["red", 0.1],
      ] as const),
    };
  });
}

// ─── Issue tracker ───────────────────────────────────────────────────────────

export interface Issue {
  id: string;
  title: string;
  account_id: string;
  state: "open" | "closed";
  priority: "P0" | "P1" | "P2" | "P3";
  team: "platform" | "billing" | "growth" | "data" | "mobile";
  assignee: string;
  labels: string[];
  created_at: string;
}

const TEAMS = ["platform", "billing", "growth", "data", "mobile"] as const;
const LABELS = ["bug", "regression", "perf", "ui", "infra", "security", "docs", "flaky", "customer-reported"];
const TITLE_VERBS = ["Investigate", "Fix", "Resolve", "Triage", "Reproduce", "Patch", "Roll back", "Mitigate"];
const TITLE_NOUNS = [
  "checkout 500s", "dashboard latency", "webhook retries", "data export timeout",
  "login loop", "billing mismatch", "stale cache", "rate-limit errors",
  "search relevance", "mobile crash on launch", "SSO callback failure", "report drift",
];

export function generateIssues(count: number, accountIds: string[], seed = 0x155): Issue[] {
  const rng = mulberry32(seed);
  return Array.from({ length: count }, (_, i) => {
    const labelCount = Math.floor(rng() * 4);
    const labels = Array.from({ length: labelCount }, () => pick(rng, LABELS));
    const month = 1 + Math.floor(rng() * 6);
    const day = 1 + Math.floor(rng() * 28);
    return {
      id: `ISS-${pad(1000 + i, 4)}`,
      title: `${pick(rng, TITLE_VERBS)} ${pick(rng, TITLE_NOUNS)}`,
      account_id: pick(rng, accountIds),
      state: weighted(rng, [
        ["open", 0.35],
        ["closed", 0.65],
      ] as const),
      priority: weighted(rng, [
        ["P0", 0.1],
        ["P1", 0.25],
        ["P2", 0.4],
        ["P3", 0.25],
      ] as const),
      team: pick(rng, TEAMS),
      assignee: `dev-${pad(Math.floor(rng() * 15), 2)}`,
      labels: [...new Set(labels)],
      created_at: `2026-${pad(month, 2)}-${pad(day, 2)}`,
    };
  });
}
