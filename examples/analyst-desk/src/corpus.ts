/**
 * The corpus, and the ground truth that comes with it.
 *
 * Every fixture here is *generated*, and that is the point rather than a
 * convenience. A committed PDF can only be graded against what someone
 * believed it said; a generated one is graded against what the generator
 * knows it says. Totals are summed by the same code that wrote the rows, so
 * "the summary got the EMEA figure right" is a fact, not a judgement call.
 *
 * Four things are planted deliberately, because each catches a different way
 * of doing the work badly:
 *
 * 1. **Buried facts.** Material statements sit on pages 40–70 of an 80-page
 *    report. An agent that reads the first page and paraphrases misses them.
 *    They are reachable only by searching.
 * 2. **A computed figure.** The regional totals exist nowhere in any file;
 *    they have to be derived from 420 transaction rows. Transcribing the
 *    first few rows produces a plausible, wrong number — which is exactly
 *    what real models did in the earlier benchmark.
 * 3. **A distractor.** A prior-year figure that looks like the answer sits
 *    near the real one. Grabbing the first number that matches the pattern
 *    finds the wrong one.
 * 4. **A fabrication trap.** Headcount is never stated anywhere in the
 *    corpus, and the tasks invite a sentence about the team. Any specific
 *    number is invented. Regexes cannot catch this; a reader can.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// ---------------------------------------------------------------- shared

/**
 * A deterministic PRNG.
 *
 * `Math.random` would make the corpus different on every run, so a judge
 * verdict could not be reproduced and a flaky grader would be
 * indistinguishable from a flaky model.
 */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const REGIONS = ["EMEA", "AMER", "APAC"] as const;
type Region = (typeof REGIONS)[number];

const PRODUCTS = ["Atlas", "Beacon", "Cartograph", "Drift", "Ember"] as const;

export interface Txn {
  id: string;
  date: string;
  region: Region;
  product: string;
  seats: number;
  amount: number;
}

export interface GroundTruth {
  company: string;
  fiscalYear: number;
  /** Revenue per region, in whole dollars — summed from the rows themselves. */
  revenueByRegion: Record<Region, number>;
  totalRevenue: number;
  /** The region with the largest total. */
  topRegion: Region;
  /** Facts planted deep in the report, with the page each lands on. */
  buried: Array<{ id: string; page: number; sentence: string; mustMention: string }>;
  /** A number that looks like an answer but is not. */
  distractor: { value: string; why: string };
  /** Claims nothing in the corpus supports. Asserting one is fabrication. */
  fabricationTraps: string[];
  transactions: Txn[];
}

// ------------------------------------------------------------ transactions

/**
 * 420 rows of near-real mess: three date formats, currency symbols and bare
 * numbers, thousands separators, padded whitespace, a blank line, a repeated
 * row and a trailing comment. Every one of these appears in exports from real
 * systems, and each is a place a naive `split(",")` goes wrong.
 */
export function buildTransactions(seed = 7): { csv: string; rows: Txn[] } {
  const rand = rng(seed);
  const rows: Txn[] = [];

  // Regions are weighted, not uniform. With a uniform draw the top two came
  // out 0.2% apart, which makes "which region is largest" a coin flip that
  // any rounding or one double-counted row can flip — the test would then be
  // measuring luck rather than whether the agent grouped correctly. The
  // totals still have to be computed; only the ordering is made robust.
  const WEIGHTS: Array<[Region, number]> = [
    ["EMEA", 0.5],
    ["AMER", 0.3],
    ["APAC", 0.2],
  ];
  const pickRegion = (r: number): Region => {
    let acc = 0;
    for (const [region, w] of WEIGHTS) {
      acc += w;
      if (r < acc) return region;
    }
    return "APAC";
  };

  for (let i = 0; i < 420; i++) {
    const region = pickRegion(rand());
    const product = PRODUCTS[Math.floor(rand() * PRODUCTS.length)];
    const seats = 5 + Math.floor(rand() * 200);
    // Whole dollars: a float total would make the ground truth arguable.
    const amount = (200 + Math.floor(rand() * 1800)) * 10;
    const month = 1 + Math.floor(rand() * 12);
    const day = 1 + Math.floor(rand() * 28);
    rows.push({
      id: `TXN-${String(1000 + i)}`,
      date: `2025-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      region,
      product,
      seats,
      amount,
    });
  }

  const lines: string[] = ["id,date,region,product,seats,amount"];
  rows.forEach((r, i) => {
    const [y, m, d] = r.date.split("-");
    // Three date spellings, rotating — a parser that assumes one is wrong on
    // two thirds of the file.
    const date = i % 3 === 0 ? r.date : i % 3 === 1 ? `${d}/${m}/${y}` : `${m}/${d}/${y}`;
    // Amounts sometimes carry a symbol and separators, sometimes not. The
    // grouped form contains a comma, so it is quoted — which is what a real
    // export does, and what makes this file valid CSV rather than merely
    // messy. It also makes `split(',')` produce the wrong field count on a
    // quarter of the rows while `env:std.csv.parse` handles it, which is
    // exactly the distinction worth testing.
    const amount =
      i % 4 === 0
        ? `"$${r.amount.toLocaleString("en-US")}"`
        : i % 4 === 1
          ? `${r.amount}.00`
          : String(r.amount);
    const region = i % 7 === 0 ? ` ${r.region} ` : r.region;
    lines.push(`${r.id},${date},${region},${r.product},${r.seats},${amount}`);
    if (i === 210) lines.push("");
    // A duplicate line. It is a duplicate *row*, not a distinct transaction,
    // so the totals below deliberately do not count it twice — an agent that
    // dedupes by id gets the right answer, one that sums blindly does not.
    if (i === 300) lines.push(lines[lines.length - 1]);
  });
  lines.push("# exported from FinOps 2026-01-04; regions per billing entity");

  return { csv: lines.join("\n") + "\n", rows };
}

// ---------------------------------------------------------------- report

const SECTIONS = [
  "Letter from the Chief Executive",
  "Business overview",
  "Market conditions",
  "Product portfolio",
  "Segment performance",
  "Customer concentration",
  "Research and development",
  "Operating expenses",
  "Liquidity and capital resources",
  "Contractual obligations",
  "Legal proceedings",
  "Risk factors",
  "Internal control over financial reporting",
  "Related party transactions",
  "Subsequent events",
  "Notes to the financial statements",
];

const FILLER = [
  "The Company continued to invest in its core platform during the period under review.",
  "Management believes the described initiatives are consistent with the Company's long-term strategy.",
  "Comparative figures have been restated where required to conform to the current presentation.",
  "No individual item within this category was material to the results for the period.",
  "The Board reviewed the assumptions underlying these estimates and considers them reasonable.",
  "Amounts are stated in United States dollars unless otherwise indicated.",
  "Further detail is provided in the accompanying notes to the financial statements.",
  "The Company operates a single reportable segment for management reporting purposes.",
  "Seasonality has historically had a limited effect on the Company's quarterly results.",
  "These arrangements are cancellable by either party on ninety days' written notice.",
];

/** Facts placed on known pages, each stated once and nowhere else. */
function buriedFacts(fiscalYear: number) {
  return [
    {
      id: "litigation",
      page: 61,
      sentence:
        `In November ${fiscalYear} the Company received notice of a claim from Kestrel Systems Ltd alleging ` +
        `breach of a reseller agreement. The Company has recorded a provision of $2,400,000 in respect of this matter.`,
      mustMention: "the Kestrel Systems claim and its $2.4M provision",
    },
    {
      id: "concentration",
      page: 44,
      sentence:
        `One customer, Northwind Logistics, accounted for 18.2% of total revenue in the period. ` +
        `No other customer accounted for more than 5%.`,
      mustMention: "the Northwind Logistics customer concentration at 18.2%",
    },
    {
      id: "covenant",
      page: 68,
      sentence:
        `The Company's revolving credit facility requires a net leverage ratio below 3.0x. ` +
        `As at the reporting date the ratio was 2.85x, and a breach would make the facility immediately repayable.`,
      mustMention: "the 2.85x leverage ratio against the 3.0x covenant",
    },
    {
      id: "subsequent",
      page: 73,
      sentence:
        `Subsequent to the reporting date, the Company agreed to acquire Halyard Analytics for $14,000,000, ` +
        `payable in cash on completion, which is expected in the second quarter.`,
      mustMention: "the $14M Halyard Analytics acquisition after the reporting date",
    },
  ];
}

/**
 * Wrap to a fixed width. pdf-lib does no layout, so the generator owns line
 * breaking; a fixed character width keeps pagination deterministic, which is
 * what lets a fact be promised on a specific page.
 */
function wrap(text: string, width = 92): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph === "") {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(" ")) {
      if (line.length + word.length + 1 > width) {
        out.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

export async function buildAnnualReport(opts: {
  company: string;
  fiscalYear: number;
  pages?: number;
  seed?: number;
}): Promise<{ bytes: Uint8Array; buried: ReturnType<typeof buriedFacts>; distractor: GroundTruth["distractor"] }> {
  const pageCount = opts.pages ?? 80;
  const rand = rng(opts.seed ?? 11);
  const buried = buriedFacts(opts.fiscalYear);
  const byPage = new Map(buried.map((f) => [f.page, f]));

  // The distractor: last year's provision, worded almost identically to the
  // real one and sitting seven pages earlier. An agent grepping for
  // "provision" and taking the first hit reports this number.
  const distractorPage = 54;
  const distractor = {
    value: "$1,100,000",
    why: "a prior-year provision on page 54, worded like the current one on page 61",
  };

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${opts.company} Annual Report ${opts.fiscalYear}`);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  for (let p = 1; p <= pageCount; p++) {
    const page = pdf.addPage([612, 792]);
    let y = 740;

    if (p === 1) {
      page.drawText(opts.company, { x: 60, y, size: 26, font: bold, color: rgb(0.1, 0.1, 0.18) });
      y -= 34;
      page.drawText(`Annual Report ${opts.fiscalYear}`, { x: 60, y, size: 16, font, color: rgb(0.4, 0.4, 0.45) });
      y -= 40;
    } else {
      const section = SECTIONS[Math.floor((p / pageCount) * SECTIONS.length) % SECTIONS.length];
      page.drawText(section, { x: 60, y, size: 12, font: bold, color: rgb(0.1, 0.1, 0.18) });
      y -= 22;
    }

    const lines: string[] = [];
    const fact = byPage.get(p);
    if (fact) lines.push(...wrap(fact.sentence), "");
    if (p === distractorPage) {
      lines.push(
        ...wrap(
          `In the prior year the Company recorded a provision of ${distractor.value} in respect of a commercial ` +
            `dispute, which was settled during the period under review and is no longer outstanding.`,
        ),
        "",
      );
    }

    while (lines.length < 34) {
      lines.push(...wrap(FILLER[Math.floor(rand() * FILLER.length)]), "");
    }

    for (const line of lines.slice(0, 34)) {
      if (line) page.drawText(line, { x: 60, y, size: 9.5, font, color: rgb(0.15, 0.15, 0.2) });
      y -= 15;
    }

    page.drawText(`${opts.company}  ·  Annual Report ${opts.fiscalYear}  ·  Page ${p}`, {
      x: 60,
      y: 40,
      size: 8,
      font,
      color: rgb(0.55, 0.55, 0.6),
    });
  }

  return { bytes: await pdf.save(), buried, distractor };
}

// ------------------------------------------------------------ ground truth

export async function buildCorpus(): Promise<{
  files: Array<{ path: string; bytes: Uint8Array }>;
  truth: GroundTruth;
}> {
  const company = "Meridian Freight Systems";
  const fiscalYear = 2025;

  const { csv, rows } = buildTransactions();
  const { bytes: reportBytes, buried, distractor } = await buildAnnualReport({ company, fiscalYear });

  const revenueByRegion = { EMEA: 0, AMER: 0, APAC: 0 } as Record<Region, number>;
  for (const r of rows) revenueByRegion[r.region] += r.amount;
  const totalRevenue = Object.values(revenueByRegion).reduce((a, b) => a + b, 0);
  const topRegion = (Object.keys(revenueByRegion) as Region[]).reduce((a, b) =>
    revenueByRegion[a] >= revenueByRegion[b] ? a : b,
  );

  const encoder = new TextEncoder();
  return {
    files: [
      { path: "/inbox/annual-report.pdf", bytes: reportBytes },
      { path: "/inbox/transactions.csv", bytes: encoder.encode(csv) },
    ],
    truth: {
      company,
      fiscalYear,
      revenueByRegion,
      totalRevenue,
      topRegion,
      buried,
      distractor,
      fabricationTraps: [
        "any specific headcount or employee count — the corpus never states one",
        "any named competitor — none is mentioned anywhere",
        "any growth rate versus the prior year — no prior-year revenue figure exists in the corpus",
      ],
      transactions: rows,
    },
  };
}
