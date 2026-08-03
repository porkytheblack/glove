/**
 * Solve every scenario the way a competent agent would, then grade it.
 *
 * This proves the graders are *passable* before any money is spent on a real
 * model. A benchmark whose tasks cannot be completed measures nothing, and
 * that failure is invisible until you look — every model simply scores zero.
 */
import { SCENARIOS, makeScenarioEnv } from "./scenarios";
import type { WorkingEnvironment } from "glove-working-environment";

/** The reference solution for each scenario, written as the model would write it. */
const SOLUTIONS: Record<string, (env: WorkingEnvironment) => Promise<void>> = {
  "pdf-report": async (env) => {
    await env.fs.writeFile(
      "/scripts/report.js",
      `import { readFile } from 'env:fs';
       import { csv } from 'env:std';
       import { pdf } from 'env:documents';

       /** Totals revenue by region and renders a PDF. */
       export default async function main() {
         const rows = csv.parse(await readFile('/inbox/sales.csv'));
         const totals = new Map();
         for (const r of rows) totals.set(r.region, (totals.get(r.region) ?? 0) + Number(r.revenue));
         return pdf.create('/out/report.pdf', {
           title: 'Q3 Review',
           content: [
             { heading: 'Revenue by region' },
             { table: { headers: ['Region', 'Revenue'], rows: [...totals].map(([r, v]) => [r, v]) } },
           ],
         });
       }`,
    );
    await env.runScript("/scripts/report.js");
  },

  "script-library": async (env) => {
    await env.fs.writeFile(
      "/scripts/word_count.js",
      `import { readFile } from 'env:fs';

       /**
        * Counts whitespace-separated words in a file.
        * @param {{ path: string }} args
        * @returns {Promise<{ words: number }>}
        */
       export default async function wordCount(args) {
         const text = await readFile(args.path);
         return { words: text.split(/\\s+/).filter(Boolean).length };
       }`,
    );
    await env.runScript("/scripts/word_count.js", { path: "/inbox/notes.txt" });
  },

  "custom-stdlib": async (env) => {
    await env.fs.writeFile(
      "/scripts/animate.js",
      `import { glob } from 'env:fs';
       import { clip, describe } from 'env:motion';

       /** Builds an animated clip from the inbox frames. */
       export default async function main() {
         const frames = (await glob('/inbox/frames/*.png')).sort();
         await clip(frames, '/out/animation.gif', { frameMs: 250 });
         return describe('/out/animation.gif');
       }`,
    );
    await env.runScript("/scripts/animate.js");
  },

  compose: async (env) => {
    await env.fs.writeFile(
      "/scripts/deliverable.js",
      `import { glob, readFile } from 'env:fs';
       import { csv } from 'env:std';
       import { contactSheet } from 'env:images';
       import { pdf } from 'env:documents';

       /** Builds the combined field report. */
       export default async function main() {
         const shots = (await glob('/inbox/shots/*.png')).sort();
         await contactSheet(shots, '/tmp/sheet.png', { cell: 160, columns: 3 });
         const rows = csv.parse(await readFile('/inbox/sales.csv'));
         const totals = new Map();
         for (const r of rows) totals.set(r.region, (totals.get(r.region) ?? 0) + Number(r.revenue));
         return pdf.create('/out/deliverable.pdf', {
           title: 'Field Report',
           content: [
             { heading: 'Revenue by region' },
             { table: { headers: ['Region', 'Revenue'], rows: [...totals].map(([r, v]) => [r, v]) } },
             { heading: 'Site photos', level: 2 },
             { image: '/tmp/sheet.png', width: 420 },
           ],
         });
       }`,
    );
    await env.runScript("/scripts/deliverable.js");
  },

  "xlsx-pipeline": async (env) => {
    await env.fs.writeFile(
      "/scripts/paid.js",
      `import { read, write } from 'env:spreadsheets';
       import { writeFile } from 'env:fs';
       import { csv } from 'env:std';

       /** Totals paid orders per customer. */
       export default async function main() {
         const { rows } = await read('/inbox/orders.xlsx');
         const totals = new Map();
         for (const r of rows) {
           if (String(r.status) !== 'paid') continue;
           totals.set(r.customer, (totals.get(r.customer) ?? 0) + Number(r.amount));
         }
         const out = [...totals].map(([customer, total]) => ({ customer, total }));
         await write('/out/paid.xlsx', out);
         await writeFile('/out/paid.csv', csv.stringify(out));
         return out;
       }`,
    );
    await env.runScript("/scripts/paid.js");
  },

  "messy-input": async (env) => {
    await env.fs.writeFile(
      "/scripts/messy.js",
      `import { readFile } from 'env:fs';
       import { csv } from 'env:std';
       import { pdf } from 'env:documents';

       /** Totals the semicolon-delimited revenue file. */
       export default async function main() {
         const raw = await readFile('/inbox/messy.csv');
         const rows = csv.parse(raw, { delimiter: ';' });
         const totals = new Map();
         for (const r of rows) {
           const key = Object.keys(r).find(k => k.trim().toLowerCase() === 'region');
           const val = Object.keys(r).find(k => k.trim().toLowerCase() === 'revenue');
           const region = String(r[key]).trim();
           if (!region) continue;
           totals.set(region, (totals.get(region) ?? 0) + Number(String(r[val]).trim()));
         }
         return pdf.create('/out/messy.pdf', {
           title: 'Regional Totals',
           content: [{ table: { headers: ['Region', 'Total'], rows: [...totals].map(([a, b]) => [a, b]) } }],
         });
       }`,
    );
    await env.runScript("/scripts/messy.js");
  },

  "reuse-library": async (env) => {
    // The point of the scenario: run the inherited script, do not rewrite it.
    const run = await env.runScript("/scripts/tally_visits.js", { path: "/inbox/visits.txt" });
    if (!run.ok) throw new Error(`inherited script failed: ${run.error}`);
    const counts = (run.result as { counts: Record<string, number> }).counts;
    await env.fs.writeFile("/out/counts.json", JSON.stringify(counts, null, 2));
  },

  "docx-report": async (env) => {
    await env.fs.writeFile(
      "/scripts/summary.js",
      `import { readFile } from 'env:fs';
       import { csv } from 'env:std';
       import { docx } from 'env:documents';

       /** Writes the sales summary as a Word document. */
       export default async function main() {
         const rows = csv.parse(await readFile('/inbox/sales.csv'));
         const totals = new Map();
         for (const r of rows) totals.set(r.region, (totals.get(r.region) ?? 0) + Number(r.revenue));
         return docx.create('/out/summary.docx', {
           title: 'Sales Summary',
           content: [
             { heading: 'By region' },
             { table: { headers: ['Region', 'Revenue'], rows: [...totals].map(([a, b]) => [a, b]) } },
           ],
         });
       }`,
    );
    await env.runScript("/scripts/summary.js");
  },
};

async function main(): Promise<void> {
  let failures = 0;

  for (const scenario of SCENARIOS) {
    const env = await makeScenarioEnv(scenario);
    const solve = SOLUTIONS[scenario.name];
    if (!solve) {
      console.log(`?? ${scenario.name}: no reference solution`);
      failures += 1;
      continue;
    }

    try {
      await solve(env);
    } catch (e) {
      console.log(`FAIL ${scenario.name}: reference solution threw — ${e instanceof Error ? e.message : String(e)}`);
      failures += 1;
      continue;
    }

    const checks = await scenario.grade(env);
    const ok = checks.every((c) => c.ok);
    if (!ok) failures += 1;
    console.log(`${ok ? "PASS" : "FAIL"} ${scenario.name.padEnd(16)} ${checks.filter((c) => c.ok).length}/${checks.length}`);
    for (const c of checks.filter((x) => !x.ok)) console.log(`       ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  }

  console.log(failures === 0 ? "\nAll scenarios are solvable." : `\n${failures} scenario(s) not solvable — fix before benchmarking.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
