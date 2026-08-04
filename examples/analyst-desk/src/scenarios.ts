/**
 * What the agent is asked to do, and how the result is graded.
 *
 * Grading is two-tier, and the split is the whole design:
 *
 * - **Deterministic checks** own everything that is a *fact*. Does the file
 *   exist, is the EMEA total $2,435,210, does the deck have five slides. A
 *   model judging these would be strictly worse than an equality test — it
 *   can only add noise to something already known exactly.
 * - **The judge** owns everything that is a *reading*. Is the summary
 *   faithful to the source, does it surface the material facts, does it
 *   assert anything the corpus never said. No regex decides that.
 *
 * The tasks describe an outcome, never a method. Telling the agent to "use
 * grep" would test whether it can follow instructions; the interesting
 * question is whether an 80-page document is workable at all when the only
 * way through is to search it.
 */
import type { WorkingEnvironment } from "glove-working-environment";
// The deck is read back with the slides package's own ZIP+OOXML reader, not
// with pptxgenjs and not by asking the environment — a verifier that trusts
// the thing under test is not a verifier.
import { readDeck } from "glove-env-slides";
import type { GroundTruth } from "./corpus";

export interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

export interface JudgeQuestion {
  id: string;
  /** Asked of the judge in plain language, answerable from the evidence given. */
  question: string;
}

export interface Scenario {
  id: string;
  /** One line for the report. */
  summary: string;
  task: string;
  maxTurns: number;
  /** Facts, checked exactly. */
  check(env: WorkingEnvironment, truth: GroundTruth): Promise<CheckResult[]>;
  /** Which artifacts the judge should be shown. Globs against the final tree. */
  artifacts: string[];
  /** Readings, checked by a stronger model. */
  questions(truth: GroundTruth): JudgeQuestion[];
}

const money = (n: number) => `$${n.toLocaleString("en-US")}`;

/** Read a text file, or "" when the agent never produced it. */
async function text(env: WorkingEnvironment, path: string): Promise<string> {
  try {
    return await env.fs.readFile(path);
  } catch {
    return "";
  }
}

async function firstMatch(env: WorkingEnvironment, pattern: string): Promise<string | null> {
  const hits = await env.fs.glob(pattern);
  return hits.length > 0 ? hits[0] : null;
}

/**
 * Numbers as written by a model: `$2,435,210`, `2435210`, `2.44M`, `2,435,210.00`.
 * Matching only the exact string would fail a correct answer for formatting.
 */
function mentionsAmount(haystack: string, value: number): boolean {
  const plain = String(value);
  const grouped = value.toLocaleString("en-US");
  const millions = (value / 1_000_000).toFixed(2);
  const millionsShort = (value / 1_000_000).toFixed(1);
  const normalised = haystack.replace(/[,\s]/g, "");
  return (
    normalised.includes(plain) ||
    haystack.includes(grouped) ||
    haystack.includes(millions) ||
    haystack.includes(millionsShort)
  );
}

export const SCENARIOS: Scenario[] = [
  {
    id: "pdf-review",
    summary: "An 80-page report that cannot be read into context — only searched.",
    maxTurns: 22,
    task:
      `/inbox/annual-report.pdf is the annual report for Meridian Freight Systems. It is 80 pages, so you ` +
      `cannot read it into your context — you will need to get its text into the environment and search it.\n\n` +
      `Write a briefing to /out/briefing.md for a director who has not read the report. It must cover every ` +
      `matter that would change how they think about the company's risk: litigation, customer concentration, ` +
      `debt covenants, and anything that happened after the reporting date. Give the specific figures and say ` +
      `which page each came from.\n\n` +
      `Be careful: the report discusses more than one provision, and only one of them is still outstanding.`,
    artifacts: ["/out/briefing.md"],
    async check(env) {
      const briefing = await text(env, "/out/briefing.md");
      const out: CheckResult[] = [
        {
          name: "briefing exists",
          passed: briefing.trim().length > 0,
          detail: briefing.trim().length > 0 ? `${briefing.length} chars` : "no /out/briefing.md",
        },
      ];
      // Each buried fact carries a figure stated exactly once in the corpus.
      const needles: Array<[string, RegExp]> = [
        ["litigation provision $2.4M", /2[,.]4(00[,.]000)?\s*(M|million)?/i],
        ["Kestrel named", /kestrel/i],
        ["concentration 18.2%", /18\.2\s*%/],
        ["Northwind named", /northwind/i],
        ["leverage 2.85x", /2\.85\s*x?/i],
        ["Halyard acquisition $14M", /halyard/i],
      ];
      for (const [name, re] of needles) {
        out.push({ name, passed: re.test(briefing), detail: re.test(briefing) ? "found" : "absent" });
      }
      // The distractor is a settled prior-year provision. Quoting it as
      // current is the specific mistake this scenario is built to catch.
      const quotedDistractor = /1[,.]1(00[,.]000)?\s*(M|million)?/i.test(briefing);
      out.push({
        name: "did not present the settled prior-year provision as current",
        passed: !quotedDistractor || /prior|settled|no longer|previous/i.test(briefing),
        detail: quotedDistractor ? "mentions $1.1M — judge decides whether it is correctly framed" : "not quoted",
      });
      return out;
    },
    questions: (truth) => [
      {
        id: "material-facts",
        question:
          `Does the briefing surface ALL FOUR material matters? They are: ` +
          truth.buried.map((b) => b.mustMention).join("; ") +
          `. Answer no if any one is missing or its figure is wrong.`,
      },
      {
        id: "distractor",
        question:
          `The report mentions a prior-year provision of ${truth.distractor.value} (${truth.distractor.why}) ` +
          `which was SETTLED and is no longer outstanding. Does the briefing avoid presenting that figure as a ` +
          `current or outstanding liability? Answer yes if it either omits it or clearly marks it as settled/prior-year.`,
      },
      {
        id: "fabrication",
        question:
          `Does the briefing avoid asserting anything the source could not support? Specifically it must NOT state: ` +
          truth.fabricationTraps.join("; ") +
          `. Answer no if it states any of these as fact.`,
      },
      {
        id: "usable",
        question:
          `Would a director who has not read the report be able to act on this briefing — are the figures ` +
          `attached to what they mean, rather than listed without context?`,
      },
    ],
  },

  {
    id: "csv-analysis",
    summary: "Messy real-world CSV: three date formats, currency symbols, a duplicate row.",
    maxTurns: 18,
    task:
      `/inbox/transactions.csv is a sales export. It is messy in the way real exports are: dates appear in ` +
      `three different formats, amounts sometimes carry a $ and thousands separators and sometimes do not, ` +
      `some region values have stray whitespace, and the file contains one duplicated row and a trailing ` +
      `comment line.\n\n` +
      `Each transaction id appears once legitimately — count a repeated id only once.\n\n` +
      `Write /out/revenue.json containing exactly: { "byRegion": { "EMEA": <number>, "AMER": <number>, ` +
      `"APAC": <number> }, "total": <number>, "topRegion": "<region>" }. Amounts must be numbers in whole ` +
      `dollars, not strings.`,
    artifacts: ["/out/revenue.json"],
    async check(env, truth) {
      const raw = await text(env, "/out/revenue.json");
      const out: CheckResult[] = [];
      let parsed: any = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        /* reported below */
      }
      out.push({
        name: "revenue.json is valid JSON",
        passed: parsed !== null,
        detail: parsed ? "parsed" : `unparseable: ${raw.slice(0, 80)}`,
      });
      if (!parsed) return out;

      for (const region of ["EMEA", "AMER", "APAC"] as const) {
        const got = parsed?.byRegion?.[region];
        const want = truth.revenueByRegion[region];
        out.push({
          name: `${region} = ${money(want)}`,
          passed: typeof got === "number" && got === want,
          detail: `got ${JSON.stringify(got)}`,
        });
      }
      out.push({
        name: `total = ${money(truth.totalRevenue)}`,
        passed: parsed?.total === truth.totalRevenue,
        detail: `got ${JSON.stringify(parsed?.total)}`,
      });
      out.push({
        name: `topRegion = ${truth.topRegion}`,
        passed: parsed?.topRegion === truth.topRegion,
        detail: `got ${JSON.stringify(parsed?.topRegion)}`,
      });
      return out;
    },
    // Nothing here needs a reading: every answer is a number that is either
    // right or wrong, so sending it to a judge would only add expense.
    questions: () => [],
  },

  {
    id: "deck-build",
    summary: "Produce a board deck from findings — a real .pptx, read back independently.",
    maxTurns: 20,
    task:
      `Build a short board deck at /out/board.pptx summarising Meridian Freight Systems' position.\n\n` +
      `Use /inbox/transactions.csv for the revenue picture (per region and total — the file is messy; ` +
      `dates and amounts are inconsistently formatted and one row is duplicated, count each transaction id ` +
      `once) and /inbox/annual-report.pdf for the risks. The report is 80 pages, so search it rather than ` +
      `reading it.\n\n` +
      `The deck needs: a title slide, a revenue slide showing all three regions, and a risk slide covering ` +
      `the outstanding litigation and the debt covenant position. Put a speaker note on the risk slide saying ` +
      `what the director should be ready to be asked.`,
    artifacts: ["/out/board.pptx"],
    async check(env, truth) {
      const out: CheckResult[] = [];
      const path = await firstMatch(env, "/out/*.pptx");
      out.push({ name: "a .pptx exists in /out", passed: path !== null, detail: path ?? "none" });
      if (!path) return out;

      let deck;
      try {
        deck = readDeck(await env.fs.readBytes(path));
      } catch (e) {
        out.push({ name: "deck is readable", passed: false, detail: (e as Error).message });
        return out;
      }
      out.push({ name: "deck is readable", passed: true, detail: `${deck.slides.length} slides` });
      out.push({
        name: "at least 3 slides",
        passed: deck.slides.length >= 3,
        detail: `${deck.slides.length}`,
      });

      const all = deck.slides.map((s) => `${s.title}\n${s.body.join("\n")}`).join("\n");
      for (const region of ["EMEA", "AMER", "APAC"] as const) {
        const shown = all.includes(region) && mentionsAmount(all, truth.revenueByRegion[region]);
        out.push({
          name: `${region} revenue on a slide (${money(truth.revenueByRegion[region])})`,
          passed: shown,
          detail: shown ? "present" : "region or figure missing",
        });
      }
      const notes = deck.slides.map((s) => s.notes).join("\n").trim();
      out.push({
        name: "a speaker note survives the round trip",
        passed: notes.length > 0,
        detail: notes ? `${notes.length} chars` : "no notes on any slide",
      });
      return out;
    },
    questions: (truth) => [
      {
        id: "risk-coverage",
        question:
          `Does the deck's risk content cover BOTH the outstanding litigation (${truth.buried[0].mustMention}) ` +
          `and the covenant position (${truth.buried[2].mustMention})?`,
      },
      {
        id: "fabrication",
        question:
          `Does the deck avoid asserting anything unsupported? It must NOT state: ` +
          truth.fabricationTraps.join("; ") + `.`,
      },
      {
        id: "presentable",
        question:
          `Is this deck presentable to a board — slides carrying one idea each with concrete figures, rather ` +
          `than a wall of text or empty headings?`,
      },
    ],
  },

  {
    id: "pdf-report",
    summary: "Produce a PDF whose numbers must survive being read back out.",
    maxTurns: 20,
    task:
      `Produce /out/revenue-report.pdf: a one-page revenue report for Meridian Freight Systems built from ` +
      `/inbox/transactions.csv.\n\n` +
      `The file is messy — three date formats, amounts with and without $ and separators, stray whitespace ` +
      `in some region values, one duplicated row (count each transaction id once) and a trailing comment.\n\n` +
      `The report must show revenue for each of EMEA, AMER and APAC, the total, and name the largest region. ` +
      `Give a title and make the figures readable.`,
    artifacts: ["/out/revenue-report.pdf"],
    async check(env, truth) {
      const out: CheckResult[] = [];
      const path = await firstMatch(env, "/out/*.pdf");
      out.push({ name: "a .pdf exists in /out", passed: path !== null, detail: path ?? "none" });
      if (!path) return out;

      // Extract with pdfjs — an independent reader from the pdf-lib writer,
      // so a report that only pdf-lib can make sense of fails here.
      const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const bytes = await env.fs.readBytes(path);
      let extracted = "";
      try {
        const doc = await getDocument({ data: bytes.slice(), useSystemFonts: true }).promise;
        for (let p = 1; p <= doc.numPages; p++) {
          const page = await doc.getPage(p);
          extracted += (await page.getTextContent()).items.map((i: any) => i.str).join(" ") + "\n";
        }
      } catch (e) {
        out.push({ name: "pdf is readable", passed: false, detail: (e as Error).message });
        return out;
      }
      out.push({ name: "pdf is readable", passed: extracted.trim().length > 0, detail: `${extracted.length} chars` });

      for (const region of ["EMEA", "AMER", "APAC"] as const) {
        const ok = extracted.includes(region) && mentionsAmount(extracted, truth.revenueByRegion[region]);
        out.push({
          name: `${region} figure in the PDF (${money(truth.revenueByRegion[region])})`,
          passed: ok,
          detail: ok ? "present" : "region or figure missing",
        });
      }
      out.push({
        name: `total in the PDF (${money(truth.totalRevenue)})`,
        passed: mentionsAmount(extracted, truth.totalRevenue),
        detail: mentionsAmount(extracted, truth.totalRevenue) ? "present" : "missing",
      });
      out.push({
        name: `names ${truth.topRegion} as largest`,
        passed: new RegExp(`${truth.topRegion}`, "i").test(extracted),
        detail: "checked",
      });
      return out;
    },
    questions: () => [
      {
        id: "readable",
        question:
          `Read the extracted text of this PDF. Is it laid out as a report a person could read — a title, ` +
          `labelled figures — rather than numbers run together or overlapping text?`,
      },
    ],
  },
];
