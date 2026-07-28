import { createWorkingEnvironment } from "glove-working-environment";
import { documents } from "../src/index";
import { spreadsheets } from "../../glove-env-spreadsheets/src/index";
import { images } from "../../glove-env-images/src/index";

const env = await createWorkingEnvironment({ stdlib: [documents(), spreadsheets(), images()] });
console.log("modules:", [...env.moduleDescriptions.keys()].join(", "));
console.log("--- /std/README.md ---");
console.log(await env.fs.readFile("/std/README.md"));
console.log("--- run_script description ---");
console.log(env.tools.find((t) => t.name === "run_script")!.description);
console.log("--- ls /std ---");
const ls = await env.tools.find((t) => t.name === "ls")!.do({ path: "/std", depth: 2 });
console.log(String(ls.data));

// One script that uses all three.
await env.fs.writeFile("/scripts/pipeline.js", `
import { spreadsheets } from 'env:fs';
`.trim() ? `
import { write, read } from 'env:spreadsheets';
import { describe as describeImage } from 'env:images';
import { pdf } from 'env:documents';
import { writeFile } from 'env:fs';

/** Builds a report from a sheet and an image. */
export default async function pipeline() {
  await write('/tmp/data.xlsx', [{ region: 'EMEA', revenue: 91000 }, { region: 'AMER', revenue: 51000 }]);
  const { rows } = await read('/tmp/data.xlsx');
  await pdf.create('/out/report.pdf', {
    title: 'Composed report',
    content: [
      { heading: 'Revenue' },
      { table: { headers: ['Region', 'Revenue'], rows: rows.map(r => [r.region, r.revenue]) } },
    ],
  });
  const summary = await pdf.describe('/out/report.pdf');
  return { pages: summary.pages, rows: rows.length };
}
` : "");
const run = await env.runScript("/scripts/pipeline.js");
console.log("--- cross-adapter run ---");
console.log(run.ok ? JSON.stringify(run.result) : "FAILED: " + run.error);
