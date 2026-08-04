/**
 * Solve every scenario with a hand-written reference script, then grade the
 * result with the same checks the real run uses. No API calls, no cost.
 *
 * This exists because a grader is code, and code is wrong until something
 * proves otherwise. A check with a typo'd regex fails every model equally and
 * reads exactly like a hard scenario — the earlier benchmark lost a run to
 * precisely that. If the reference solution cannot pass, the problem is here,
 * not in the model, and it is much cheaper to find out now.
 *
 * It doubles as the honest answer to "is this even possible in the
 * environment?" Every reference below is a script the environment runs, using
 * only capabilities a model has access to and can discover from /std.
 *
 * What it cannot cover is the judge: those verdicts need the judge. The
 * deterministic half is what is proven here.
 */
import { extractArtifacts, openDesk } from "./desk";
import { SCENARIOS } from "./scenarios";

/**
 * Parsing the messy export, written the way the docs point a model.
 *
 * Shared by three scenarios, because all three need the same numbers and
 * duplicating it would let them drift apart.
 */
const PARSE_CSV = `
import { readFile } from 'env:fs';
import { csv } from 'env:std';

export async function loadRows() {
  const text = await readFile('/inbox/transactions.csv');
  // A real parser, not split(','): a quarter of the amounts are quoted and
  // contain a comma, so splitting produces seven fields on those rows and
  // silently reads the wrong column.
  const records = csv.parse(text.split('\\n').filter((l) => !l.trim().startsWith('#')).join('\\n'));

  const seen = new Set();
  const rows = [];
  for (const rec of records) {
    const id = String(rec.id ?? '').trim();
    if (!id || seen.has(id)) continue;    // the duplicated row
    seen.add(id);
    const region = String(rec.region ?? '').trim();          // stray whitespace
    const amount = Number(String(rec.amount ?? '').replace(/[$,\\s]/g, ''));
    if (!Number.isFinite(amount)) continue;
    rows.push({ id, region, amount });
  }
  return rows;
}

export function byRegion(rows) {
  const out = { EMEA: 0, AMER: 0, APAC: 0 };
  for (const r of rows) if (r.region in out) out[r.region] += r.amount;
  return out;
}
`;

const REFERENCES: Record<string, Array<{ path: string; content: string }>> = {
  "pdf-review": [
    {
      path: "/scripts/lib/report.js",
      content: `
import { pdf } from 'env:documents';
import { writeFile } from 'env:fs';

/** Flatten the report to text, one page per marked block, so it can be searched. */
export async function flatten() {
  const extracted = await pdf.extractText('/inbox/annual-report.pdf');
  const body = extracted.pages.map((p) => '=== page ' + p.page + ' ===\\n' + p.text).join('\\n');
  await writeFile('/tmp/report.txt', body);
  return { pages: extracted.pages.length, characters: body.length };
}
`,
    },
    {
      path: "/scripts/brief.js",
      content: `
import { flatten } from './lib/report.js';
import { readFile, writeFile } from 'env:fs';

/** Search the flattened report for the material matters and write the briefing. */
export default async function main() {
  await flatten();
  const text = await readFile('/tmp/report.txt');

  // Page number for a match: the nearest preceding page marker.
  const pageOf = (index) => {
    const before = text.slice(0, index);
    const marks = before.match(/=== page (\\d+) ===/g) || [];
    const last = marks[marks.length - 1];
    return last ? last.replace(/\\D/g, '') : '?';
  };
  const find = (needle) => {
    const i = text.indexOf(needle);
    return i < 0 ? null : { page: pageOf(i), around: text.slice(Math.max(0, i - 200), i + 400) };
  };

  const kestrel = find('Kestrel');
  const northwind = find('Northwind');
  const leverage = find('net leverage ratio');
  const halyard = find('Halyard');

  const lines = [
    '# Meridian Freight Systems — risk briefing',
    '',
    '## Litigation',
    'Kestrel Systems Ltd has claimed breach of a reseller agreement. A provision of $2,400,000',
    'is recorded against it and remains outstanding. (p.' + (kestrel ? kestrel.page : '?') + ')',
    '',
    'A separate provision of $1,100,000 appears earlier in the report; it relates to a prior-year',
    'commercial dispute that was settled during the period and is NOT outstanding.',
    '',
    '## Customer concentration',
    'Northwind Logistics accounted for 18.2% of total revenue. No other customer exceeded 5%.',
    '(p.' + (northwind ? northwind.page : '?') + ')',
    '',
    '## Debt covenants',
    'The revolving credit facility requires net leverage below 3.0x. The reported ratio was 2.85x —',
    'a breach would make the facility immediately repayable. (p.' + (leverage ? leverage.page : '?') + ')',
    '',
    '## After the reporting date',
    'The Company agreed to acquire Halyard Analytics for $14,000,000 in cash, expected to complete',
    'in the second quarter. (p.' + (halyard ? halyard.page : '?') + ')',
  ];
  await writeFile('/out/briefing.md', lines.join('\\n'));
  return '/out/briefing.md';
}
`,
    },
  ],

  "csv-analysis": [
    { path: "/scripts/lib/txns.js", content: PARSE_CSV },
    {
      path: "/scripts/revenue.js",
      content: `
import { loadRows, byRegion } from './lib/txns.js';
import { writeFile } from 'env:fs';
import { json } from 'env:std';

export default async function main() {
  const rows = await loadRows();
  const region = byRegion(rows);
  const total = region.EMEA + region.AMER + region.APAC;
  const top = Object.keys(region).reduce((a, b) => (region[a] >= region[b] ? a : b));
  await writeFile('/out/revenue.json', json.stringify({ byRegion: region, total, topRegion: top }, 2));
  return { total, top };
}
`,
    },
  ],

  "deck-build": [
    { path: "/scripts/lib/txns.js", content: PARSE_CSV },
    {
      path: "/scripts/deck.js",
      content: `
import { loadRows, byRegion } from './lib/txns.js';
import { create } from 'env:slides';

export default async function main() {
  const rows = await loadRows();
  const r = byRegion(rows);
  const total = r.EMEA + r.AMER + r.APAC;
  const money = (n) => '$' + n.toLocaleString('en-US');

  return create({
    title: 'Meridian Freight Systems',
    subtitle: 'Board review — FY2025',
    footer: 'Confidential',
    slides: [
      {
        title: 'Revenue by region',
        table: [
          ['Region', 'Revenue'],
          ['EMEA', money(r.EMEA)],
          ['AMER', money(r.AMER)],
          ['APAC', money(r.APAC)],
          ['Total', money(total)],
        ],
      },
      {
        title: 'Risks',
        bullets: [
          'Kestrel Systems claim: $2,400,000 provision, outstanding',
          'Net leverage 2.85x against a 3.0x covenant',
          '  a breach makes the facility immediately repayable',
        ],
        notes: 'Expect to be asked how close 2.85x is to the covenant, and what happens to the Kestrel provision if the claim settles higher.',
      },
    ],
  }, '/out/board.pptx');
}
`,
    },
  ],

  "pdf-report": [
    { path: "/scripts/lib/txns.js", content: PARSE_CSV },
    {
      path: "/scripts/report.js",
      content: `
import { loadRows, byRegion } from './lib/txns.js';
import { pdf } from 'env:documents';

export default async function main() {
  const rows = await loadRows();
  const r = byRegion(rows);
  const total = r.EMEA + r.AMER + r.APAC;
  const top = Object.keys(r).reduce((a, b) => (r[a] >= r[b] ? a : b));
  const money = (n) => '$' + n.toLocaleString('en-US');

  return pdf.create('/out/revenue-report.pdf', {
    title: 'Meridian Freight Systems — FY2025 revenue',
    content: [
      { heading: 'Revenue by region' },
      {
        table: {
          headers: ['Region', 'Revenue'],
          rows: [
            ['EMEA', money(r.EMEA)],
            ['AMER', money(r.AMER)],
            ['APAC', money(r.APAC)],
            ['Total', money(total)],
          ],
        },
      },
      { text: 'Largest region: ' + top },
    ],
  });
}
`,
    },
  ],
};

async function main(): Promise<void> {
  const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const chosen = SCENARIOS.filter((s) => only.length === 0 || only.includes(s.id));

  console.log("analyst-desk selfcheck — reference solutions, no API calls\n");
  let failures = 0;

  for (const scenario of chosen) {
    process.stdout.write(`  ${scenario.id.padEnd(14)} `);
    const { env, truth } = await openDesk();
    try {
      const refs = REFERENCES[scenario.id];
      if (!refs) {
        console.log("SKIP — no reference solution");
        continue;
      }

      // Write every script first: a lib module must exist before the entry
      // that imports it is validated at write time.
      for (const ref of refs) await env.fs.writeFile(ref.path, ref.content);

      const entry = refs[refs.length - 1].path;
      const run = await env.runScript(entry);
      if (!run.ok) {
        console.log(`BROKEN — reference script failed: ${run.error}`);
        failures++;
        continue;
      }

      const checks = await scenario.check(env, truth);
      const failed = checks.filter((c) => !c.passed);
      if (failed.length === 0) {
        console.log(`ok — ${checks.length} checks pass on the reference solution`);
      } else {
        console.log(`BROKEN — ${failed.length}/${checks.length} checks fail on a CORRECT solution:`);
        for (const f of failed) console.log(`        × ${f.name}: ${f.detail}`);
        failures++;
      }

      // Exercise extraction too — the judge only ever sees its output, so a
      // silent failure here would show up as an unexplained judge verdict.
      const artifacts = await extractArtifacts(env, scenario.artifacts);
      for (const a of artifacts) {
        if (a.kind === "unreadable" || a.text.trim() === "") {
          console.log(`        × artifact ${a.path} extracted as ${a.kind}, ${a.text.length} chars`);
          failures++;
        }
      }
    } finally {
      await env.close();
    }
  }

  console.log(
    failures === 0
      ? "\nEvery scenario is solvable in the environment and every check passes on a correct answer."
      : `\n${failures} problem(s) above are in the harness, not in any model. Fix before spending.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
