/**
 * The Tesseract side of `env:ocr`: finding training data, and running a worker.
 *
 * Everything here is host-side. Nothing in this file is reachable from inside
 * the sandbox — scripts call `recognize()`, an adapter binding, exactly as
 * `env:media` reaches ffmpeg.
 *
 * **The whole point of this module is that it never touches the network.** The
 * default `tesseract.js` path downloads `<lang>.traineddata` from a CDN on
 * first use, which is fine on a laptop and useless in a sandboxed runtime with
 * no egress. So:
 *
 * - the WASM core comes from `tesseract.js-core`, a bundled dependency;
 * - English training data comes from `@tesseract.js-data/eng`, also bundled,
 *   and is handed to the worker as a local `langPath`;
 * - `cacheMethod: "none"` stops tesseract writing a `.traineddata` cache into
 *   the host's working directory, which is neither ours to write nor useful
 *   when the data is already on disk.
 *
 * Any other language is looked for in the same place — `@tesseract.js-data/<lang>` —
 * and if the host has not installed it we say so by name rather than reaching
 * for a CDN that is not there.
 */
import { createRequire } from "node:module";
import { access } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

const require = createRequire(import.meta.url);

/**
 * The tessdata variant to load.
 *
 * `4.0.0_best_int` is the integer-quantised LSTM model: ~3 MB against ~11 MB
 * for the full `4.0.0` bundle, and it is what tesseract.js itself fetches when
 * only the LSTM engine is used. We only ever use the LSTM engine (legacy
 * Tesseract needs the bigger data and is worse), so the big one buys nothing.
 */
const TESSDATA_VARIANT = "4.0.0_best_int";

/** Languages are directory/file names in a package path — keep them boring. */
const LANG_RE = /^[a-z]{3}(_[a-z]+)*$/i;

export interface RecognizedWord {
  text: string;
  confidence: number;
}

export interface RecognizedImage {
  text: string;
  /** Mean word confidence, 0–100. `0` when nothing was read. */
  confidence: number;
  words: number;
}

export class OcrLanguageError extends Error {}

export interface LangSource {
  /** Directory holding `<lang>.traineddata(.gz)`, or a URL if a host set one. */
  path: string;
  /** Whether the file on disk is the gzipped one — tesseract appends `.gz` when true. */
  gzip: boolean;
}

/**
 * Where a language's training data lives on this host.
 *
 * Resolution order, and each step exists for a reason:
 *
 * 1. an explicit `langPath` the host configured — the escape hatch for a host
 *    that vendors its own tessdata (a custom-trained model, or the full
 *    `4.0.0` set for legacy-engine work);
 * 2. `@tesseract.js-data/<lang>`, resolved through Node — this is the bundled
 *    path, and it is why English works with no host wiring at all.
 *
 * **A URL is only ever used if a host explicitly configures one.** We never
 * invent one. Inventing one is exactly how an adapter that claims to work
 * offline starts quietly requiring a network, and finds out on a real
 * document rather than at startup.
 */
export async function resolveLangPath(lang: string, configured?: string): Promise<LangSource> {
  if (!LANG_RE.test(lang)) {
    throw new OcrLanguageError(
      `${JSON.stringify(lang)} is not a language code — use a three-letter tessdata code like "eng", "deu", "chi_sim".`,
    );
  }

  if (configured) {
    // A host that points at a URL has opted into the network with its eyes
    // open; that is its business, and we do not second-guess it.
    if (/^[a-z]+:\/\//i.test(configured)) return { path: configured, gzip: true };
    const dir = isAbsolute(configured) ? configured : join(process.cwd(), configured);
    // Which spelling is actually on disk decides the `gzip` flag: tesseract
    // appends `.gz` itself, so guessing wrong turns a present file into a
    // confusing "not found".
    if (await exists(join(dir, `${lang}.traineddata.gz`))) return { path: dir, gzip: true };
    if (await exists(join(dir, `${lang}.traineddata`))) return { path: dir, gzip: false };
    throw new OcrLanguageError(
      `no ${lang}.traineddata or ${lang}.traineddata.gz in the configured langPath ${dir} — ` +
        `put the tessdata file there, or drop the langPath option to use the bundled data.`,
    );
  }

  let pkgRoot: string;
  try {
    pkgRoot = dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`));
  } catch {
    throw new OcrLanguageError(
      `no training data for ${JSON.stringify(lang)} on this host. English is bundled and always works; ` +
        `for anything else install its data package — \`npm i @tesseract.js-data/${lang}\` — ` +
        `or point the adapter at your own tessdata directory with ocr({ langPath }). ` +
        `Nothing is downloaded at run time by design.`,
    );
  }
  const dir = join(pkgRoot, TESSDATA_VARIANT);
  if (!(await exists(join(dir, `${lang}.traineddata.gz`)))) {
    throw new OcrLanguageError(
      `@tesseract.js-data/${lang} is installed but has no ${TESSDATA_VARIANT}/${lang}.traineddata.gz — ` +
        `the package layout changed. Pin a 1.x version of it, or pass ocr({ langPath }) pointing at your own tessdata.`,
    );
  }
  return { path: dir, gzip: true };
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/** Which languages this host can actually run, without loading any of them. */
export async function availableLanguages(configured: string[], langPath?: string): Promise<string[]> {
  const found = new Set<string>();
  for (const lang of configured) {
    try {
      await resolveLangPath(lang, langPath);
      found.add(lang);
    } catch {
      /* not installed — that is the answer, not an error */
    }
  }
  return [...found].sort();
}

/** The `worker_threads` handle tesseract.js hands back alongside its API. */
interface RawThread {
  ref?(): void;
  unref?(): void;
}

type TesseractWorker = {
  recognize(image: Uint8Array): Promise<{ data: { text: string; confidence: number; words?: RecognizedWord[] } }>;
  terminate(): Promise<void>;
  /** tesseract.js exposes the underlying thread; see the ref/unref note below. */
  worker?: RawThread;
};

/**
 * One Tesseract worker per language, created on demand and kept warm.
 *
 * Startup is ~370ms measured here. That is small next to a page of OCR but it
 * is paid per *call* if the worker is not held, so a five-call session pays it
 * five times for nothing.
 *
 * Keeping a `worker_threads` thread alive has one consequence worth being
 * careful about: **a live worker keeps the whole Node process alive.** An
 * adapter has no teardown hook, so a host that OCR'd one page at startup would
 * never exit — and neither would a test run. So the thread is `unref`'d
 * between jobs (it exists, it just does not vote on whether the process
 * lives) and `ref`'d again for the duration of a job, because an unref'd
 * worker with nothing else on the loop would let Node exit *while we were
 * waiting for its reply*. The counter is what makes concurrent calls safe.
 */
export class Engine {
  private readonly workers = new Map<string, Promise<TesseractWorker>>();
  private inFlight = 0;

  constructor(private readonly langPath?: string) {}

  private async spawn(lang: string): Promise<TesseractWorker> {
    const source = await resolveLangPath(lang, this.langPath);
    const { createWorker } = await import("tesseract.js");
    // oem 1 = LSTM_ONLY. It is the only engine the `_best_int` data supports,
    // and it is the better one; asking for the default would make tesseract
    // want legacy data we deliberately do not ship.
    const worker = (await createWorker(lang, 1, {
      langPath: source.path,
      gzip: source.gzip,
      // Do not write a traineddata cache into the host's cwd. The data is
      // already a file on disk; caching it again is pure side effect.
      cacheMethod: "none",
      legacyCore: false,
      legacyLang: false,
    })) as unknown as TesseractWorker;
    if (this.inFlight === 0) worker.worker?.unref?.();
    return worker;
  }

  /** OCR one already-rasterised image. */
  async recognize(png: Uint8Array, lang: string): Promise<RecognizedImage> {
    let pending = this.workers.get(lang);
    if (!pending) {
      pending = this.spawn(lang);
      this.workers.set(lang, pending);
      // A failed spawn must not be remembered — otherwise installing the data
      // package and retrying inside the same environment keeps failing.
      pending.catch(() => this.workers.delete(lang));
    }
    const worker = await pending;
    this.inFlight++;
    worker.worker?.ref?.();
    try {
      const { data } = await worker.recognize(png);
      const text = normalise(data.text ?? "");
      // `data.confidence` is Tesseract's own mean word confidence for the
      // image. On a blank page it is not 0 but whatever the engine felt about
      // nothing, so an empty result reports 0 rather than a number that reads
      // as a score.
      const words = text === "" ? 0 : text.split(/\s+/).filter(Boolean).length;
      return { text, confidence: words === 0 ? 0 : round(data.confidence ?? 0), words };
    } finally {
      if (--this.inFlight === 0) worker.worker?.unref?.();
    }
  }

  /** Terminate every warm worker. Hosts that manage lifetimes explicitly. */
  async close(): Promise<void> {
    const workers = [...this.workers.values()];
    this.workers.clear();
    await Promise.all(workers.map(async (p) => p.then((w) => w.terminate()).catch(() => {})));
  }
}

/**
 * Tesseract emits a trailing form feed and pads short lines; neither carries
 * information, and both survive into any grep the model runs against the text.
 */
function normalise(text: string): string {
  return text
    .replace(/\f/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function round(n: number): number {
  return Math.round(n * 10) / 10;
}
