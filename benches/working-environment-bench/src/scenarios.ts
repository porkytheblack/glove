/**
 * What a real agent is supposed to be able to do here.
 *
 * Every check runs host-side against the tree the model actually left behind
 * — never against what it said it did. A model that reports success and
 * produced nothing scores zero, which is the only useful convention.
 */
import { createWorkingEnvironment, fromSnapshot, type StdlibAdapter, type WorkingEnvironment } from "glove-working-environment";
import { documents } from "glove-env-documents";
import { images } from "glove-env-images";
import { spreadsheets } from "glove-env-spreadsheets";
import sharp from "sharp";
import { motion } from "./motion";

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export interface Scenario {
  name: string;
  /** One line for the results table. */
  what: string;
  adapters: () => StdlibAdapter[];
  setup: (env: WorkingEnvironment) => Promise<void>;
  task: string;
  grade: (env: WorkingEnvironment) => Promise<Check[]>;
  maxTurns?: number;
}

const SALES_CSV = `region,rep,units,revenue
EMEA,Ada,12,8400
AMER,Bob,7,5100
EMEA,Cy,3,1200
APAC,Dee,9,6300
AMER,Eve,4,2900
`;

async function solidPng(w: number, h: number, colour: string): Promise<Uint8Array> {
  return new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: colour } }).png().toBuffer());
}

/** Read a PDF's text host-side, so grading never depends on the model's own report. */
async function pdfText(env: WorkingEnvironment, path: string): Promise<string> {
  const adapter = documents().create(env.fs) as unknown as {
    pdf: { extractText(p: string): Promise<{ text: string }> };
  };
  const { text } = await adapter.pdf.extractText(path);
  return text.replace(/\s+/g, " ");
}

const check = (name: string, ok: boolean, detail = ""): Check => ({ name, ok, detail });

// ────────────────────────────────────────────────────────── 1. PDF authoring

const pdfReport: Scenario = {
  name: "pdf-report",
  what: "Turn a CSV into a one-page PDF with a per-region revenue table",
  adapters: () => [documents(), spreadsheets()],
  async setup(env) {
    await env.mount({ text: SALES_CSV }, "/inbox/sales.csv");
  },
  task: `/inbox/sales.csv holds sales rows. Produce a PDF at /out/report.pdf titled "Q3 Review" containing a table of each region with its TOTAL revenue (sum the rows — EMEA appears twice, AMER twice). Three regions in total.`,
  async grade(env) {
    const checks: Check[] = [];
    const exists = await env.fs.exists("/out/report.pdf");
    checks.push(check("deliverable at /out/report.pdf", exists));
    if (!exists) return checks;

    const bytes = await env.fs.readBytes("/out/report.pdf");
    checks.push(check("is a real PDF", Buffer.from(bytes.subarray(0, 4)).toString() === "%PDF"));

    let text = "";
    try {
      text = await pdfText(env, "/out/report.pdf");
    } catch (e) {
      checks.push(check("PDF is readable", false, e instanceof Error ? e.message : String(e)));
      return checks;
    }
    checks.push(check("names all three regions", ["EMEA", "AMER", "APAC"].every((r) => text.includes(r)), text.slice(0, 120)));
    // Totals: EMEA 9600, AMER 8000, APAC 6300.
    const totals = ["9600", "8000", "6300"];
    const found = totals.filter((t) => text.includes(t));
    checks.push(check("totals are summed correctly", found.length === 3, `found ${found.join(",") || "none"} of ${totals.join(",")}`));
    checks.push(check("title present", /Q3 Review/i.test(text)));
    return checks;
  },
};

// ──────────────────────────────────────────── 2. Persistent script library

const scriptLibrary: Scenario = {
  name: "script-library",
  what: "Write a reusable script, then have it survive a snapshot/restore and run again",
  adapters: () => [],
  async setup(env) {
    await env.mount({ text: "the quick brown fox\njumps over the lazy dog\n" }, "/inbox/notes.txt");
  },
  task: `Write a REUSABLE script at /scripts/word_count.js that takes { path } and returns { words } — the number of whitespace-separated words in that file. Give it a JSDoc comment. Then run it on /inbox/notes.txt and tell me the count.`,
  async grade(env) {
    const checks: Check[] = [];
    const exists = await env.fs.exists("/scripts/word_count.js");
    checks.push(check("script stored at /scripts/word_count.js", exists));
    if (!exists) return checks;

    checks.push(check("derived .d.ts generated", await env.fs.exists("/scripts/word_count.d.ts")));

    const dts = (await env.fs.exists("/scripts/word_count.d.ts")) ? await env.fs.readFile("/scripts/word_count.d.ts") : "";
    checks.push(check("script is self-documenting (JSDoc reached the .d.ts)", /\/\*\*/.test(dts), dts.split("\n")[0] ?? ""));

    const ranIt = await env.fs.exists("/.env/history.jsonl");
    const history = ranIt ? await env.fs.readFile("/.env/history.jsonl") : "";
    checks.push(check("the model actually ran it", history.includes("/scripts/word_count.js")));

    // The real question: does a stored script still work in a *new process*
    // restored from a snapshot, on input it has never seen?
    const snap = await env.snapshot();
    const restored = await createWorkingEnvironment({ filesystem: fromSnapshot(snap) });
    await restored.fs.writeFile("/inbox/second.txt", "one two three four five");
    const rerun = await restored.runScript("/scripts/word_count.js", { path: "/inbox/second.txt" });
    checks.push(
      check(
        "survives snapshot → restore and runs on new input",
        rerun.ok && (rerun.result as { words?: number })?.words === 5,
        rerun.ok ? JSON.stringify(rerun.result) : (rerun.error ?? "").slice(0, 160),
      ),
    );
    return checks;
  },
};

// ──────────────────────────────────────────────── 3. Bespoke custom stdlib

const customStdlib: Scenario = {
  name: "custom-stdlib",
  what: "Discover a host-supplied adapter the environment has never heard of, and use it",
  adapters: () => [motion()],
  async setup(env) {
    const colours = ["#e2402a", "#2ac0e2", "#8ce22a", "#e2c02a"];
    for (let i = 0; i < colours.length; i++) {
      await env.mount(await solidPng(64, 48, colours[i]), `/inbox/frames/frame-${i + 1}.png`);
    }
  },
  task: `/inbox/frames/ holds PNG stills numbered in order. Assemble them into an animated clip at /out/animation.gif where each frame is held for 250ms. Then report the clip's frame count and total duration.`,
  async grade(env) {
    const checks: Check[] = [];
    const exists = await env.fs.exists("/out/animation.gif");
    checks.push(check("deliverable at /out/animation.gif", exists));
    if (!exists) return checks;

    const bytes = await env.fs.readBytes("/out/animation.gif");
    const meta = await sharp(Buffer.from(bytes), { animated: true }).metadata();
    checks.push(check("is a GIF", meta.format === "gif", String(meta.format)));
    checks.push(check("has all four frames", meta.pages === 4, `pages=${meta.pages}`));
    const delays = Array.isArray(meta.delay) ? meta.delay : [];
    checks.push(check("honours the 250ms frame timing", delays.length > 0 && delays.every((d) => d === 250), `delays=${delays.join(",")}`));
    return checks;
  },
};

// ─────────────────────────────────────────── 4. Composing several adapters

const composeDeliverable: Scenario = {
  name: "compose",
  what: "Combine images and tabular data into one PDF deliverable",
  adapters: () => [documents(), images(), spreadsheets()],
  maxTurns: 22,
  async setup(env) {
    await env.mount({ text: SALES_CSV }, "/inbox/sales.csv");
    const colours = ["#3355aa", "#aa3355", "#55aa33"];
    for (let i = 0; i < colours.length; i++) {
      await env.mount(await solidPng(200, 150, colours[i]), `/inbox/shots/shot-${i + 1}.png`);
    }
  },
  task: `Build a single PDF at /out/deliverable.pdf that contains BOTH: (a) a table of each region from /inbox/sales.csv with its total revenue, and (b) an embedded contact-sheet image tiling the three PNGs in /inbox/shots/. Title it "Field Report".`,
  async grade(env) {
    const checks: Check[] = [];
    const exists = await env.fs.exists("/out/deliverable.pdf");
    checks.push(check("deliverable at /out/deliverable.pdf", exists));
    if (!exists) return checks;

    const bytes = await env.fs.readBytes("/out/deliverable.pdf");
    checks.push(check("is a real PDF", Buffer.from(bytes.subarray(0, 4)).toString() === "%PDF"));
    // An embedded raster is an image XObject. Byte size would be a bad proxy:
    // a contact sheet of flat colours compresses to under 2 KB.
    const raw = Buffer.from(bytes).toString("latin1");
    checks.push(check("embeds an image", raw.includes("/Image"), `${bytes.byteLength} bytes`));

    let text = "";
    try {
      text = await pdfText(env, "/out/deliverable.pdf");
    } catch (e) {
      checks.push(check("PDF is readable", false, e instanceof Error ? e.message : String(e)));
      return checks;
    }
    checks.push(check("names all three regions", ["EMEA", "AMER", "APAC"].every((r) => text.includes(r))));
    checks.push(check("title present", /Field Report/i.test(text)));
    return checks;
  },
};

export const SCENARIOS: Scenario[] = [pdfReport, scriptLibrary, customStdlib, composeDeliverable];

export async function makeScenarioEnv(scenario: Scenario): Promise<WorkingEnvironment> {
  const env = await createWorkingEnvironment({ stdlib: scenario.adapters() });
  await scenario.setup(env);
  return env;
}
