/**
 * The desk: an environment stocked with the corpus and the adapters an
 * analyst needs, plus the extraction that turns whatever the agent produced
 * back into text a judge can read.
 *
 * Extraction always goes through a *different* library than production did —
 * pdfjs reads what pdf-lib wrote, the slides package's own OOXML reader reads
 * what pptxgenjs wrote. A verifier sharing a library with the writer only
 * proves the pair agree with each other.
 */
import { createWorkingEnvironment, type WorkingEnvironment } from "glove-working-environment";
import { documents } from "glove-env-documents";
import { spreadsheets } from "glove-env-spreadsheets";
import { images } from "glove-env-images";
import { slides, readDeck } from "glove-env-slides";
import { buildCorpus, type GroundTruth } from "./corpus";

export interface Desk {
  env: WorkingEnvironment;
  truth: GroundTruth;
}

export async function openDesk(opts: { requireDocsBeforeWrite?: boolean } = {}): Promise<Desk> {
  const { files, truth } = await buildCorpus();
  const env = await createWorkingEnvironment({
    stdlib: [documents(), spreadsheets(), images(), slides()],
    limits: {
      // The 80-page report extracts to roughly 200 KB of text, and the agent
      // is expected to write that into the tree and search it. The default
      // 128 MiB cap is ample; what actually matters is that the response caps
      // stay at their defaults, because those are what force searching rather
      // than reading — and they are the reason a run of this scenario costs
      // cents instead of dollars.
      runTimeoutMs: 60_000,
    },
    // Refuse a script write until the docs it imports have been read. Off in
    // the environment by default; the eval is where the question gets an
    // answer, since the whole point is whether it moves the delivery rate.
    requireDocsBeforeWrite: opts.requireDocsBeforeWrite ?? false,
    // Route the heap-ceiling notice into the run rather than onto stdout,
    // where it would interleave with progress output.
    execution: { onWarning: () => {} },
  });

  for (const file of files) await env.mount(file.bytes, file.path);
  return { env, truth };
}

/** A human-readable rendering of the ground truth, for the judge's prompt. */
export function groundTruthText(truth: GroundTruth): string {
  return [
    `Company: ${truth.company}, fiscal year ${truth.fiscalYear}.`,
    ``,
    `Revenue by region (computed from the 420 transaction rows, each id counted once):`,
    ...Object.entries(truth.revenueByRegion).map(([r, v]) => `  ${r}: $${v.toLocaleString("en-US")}`),
    `  TOTAL: $${truth.totalRevenue.toLocaleString("en-US")}`,
    `  Largest region: ${truth.topRegion}`,
    ``,
    `Material facts in the annual report, each stated exactly once and nowhere else:`,
    ...truth.buried.map((b) => `  p.${b.page}: ${b.sentence}`),
    ``,
    `Distractor: ${truth.distractor.value} appears as ${truth.distractor.why}. It was SETTLED and is not outstanding.`,
    ``,
    `Nothing in the corpus supports any of the following, so asserting one is a fabrication:`,
    ...truth.fabricationTraps.map((t) => `  - ${t}`),
  ].join("\n");
}

export interface ExtractedArtifact {
  path: string;
  kind: string;
  text: string;
}

/**
 * Turn the files an agent produced into text.
 *
 * A missing artifact is not an error here — it is a result, and one the judge
 * should see stated plainly rather than as an empty string that reads like an
 * empty document.
 */
export async function extractArtifacts(env: WorkingEnvironment, patterns: string[]): Promise<ExtractedArtifact[]> {
  const out: ExtractedArtifact[] = [];
  const seen = new Set<string>();

  for (const pattern of patterns) {
    // An exact path may not exist; a glob finds whatever the agent actually
    // named, which is more informative than reporting nothing at all.
    // Capped, because that fallback matches the whole directory and an agent
    // that scattered twenty intermediates would otherwise push the questions
    // out of the judge's prompt with its own scratch files.
    const direct = (await env.fs.exists(pattern)) ? [pattern] : [];
    const globbed = direct.length > 0 ? direct : (await env.fs.glob(pattern.replace(/[^/]+$/, "*"))).slice(0, 4);

    for (const path of globbed) {
      if (seen.has(path)) continue;
      seen.add(path);
      out.push(await extractOne(env, path));
    }
  }
  return out;
}

async function extractOne(env: WorkingEnvironment, path: string): Promise<ExtractedArtifact> {
  const lower = path.toLowerCase();
  try {
    if (lower.endsWith(".pdf")) {
      const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const bytes = await env.fs.readBytes(path);
      const doc = await getDocument({ data: bytes.slice(), useSystemFonts: true }).promise;
      let text = "";
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        text += (await page.getTextContent()).items.map((i: any) => i.str).join(" ") + "\n";
      }
      return { path, kind: `pdf, ${doc.numPages} page(s)`, text };
    }

    if (lower.endsWith(".pptx")) {
      const deck = readDeck(await env.fs.readBytes(path));
      const text = deck.slides
        .map((s) => {
          const parts = [`## Slide ${s.slide}: ${s.title}`, ...s.body];
          if (s.notes) parts.push(`> speaker notes: ${s.notes}`);
          return parts.join("\n");
        })
        .join("\n\n");
      return { path, kind: `pptx, ${deck.slides.length} slide(s)`, text };
    }

    return { path, kind: "text", text: await env.fs.readFile(path) };
  } catch (e) {
    // A corrupt artifact is a finding. Saying so beats handing the judge an
    // empty string it would read as an empty but valid document.
    return { path, kind: "unreadable", text: `[could not be read: ${(e as Error).message}]` };
  }
}
