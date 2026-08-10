/**
 * Parsing a workbook once instead of once per page.
 *
 * `read({ offset, limit })` is how the docs tell a model to walk a big sheet,
 * and every call used to `wb.xlsx.load` the whole file again — so a paged loop
 * over a 100k-row export cost O(rows²/limit). Measured on a 100k × 6 sheet:
 * 20 pages of 5000, 71.5s total, every page ~3.5s because every page did the
 * same full parse.
 *
 * Two changes, and both are needed:
 *
 * - **Stream, don't load.** exceljs's `WorkbookReader` walks the sheet XML and
 *   hands back one row at a time, which is flattened here into plain scalars
 *   and dropped. `wb.xlsx.load` instead builds a live cell object per cell and
 *   keeps them all. Measured on that same file: 2.7s and 32 MB against 4.4s
 *   and 291 MB.
 * - **Keep the flattened sheet.** Streaming alone still re-reads the file per
 *   page. The compact matrix is cached per path so a paged loop parses once
 *   and every page after the first is a slice.
 *
 * The cache is created per adapter instance, which means per environment. That
 * is a boundary, not an implementation detail: a cache keyed by path and
 * shared across environments would hand one tenant's rows to another the
 * moment two agents used the same filename.
 */
import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import { cellFormula, normalizeCell, type CellValue } from "./cells";
import type { EnvFsHandle } from "glove-working-environment";

export const XLSX_HINT =
  "expected an .xlsx workbook — .xls (the old binary format) and Numbers/ODS files are not supported; convert first or use a CSV";

/** One sheet, flattened to plain JSON scalars. */
export interface ParsedSheet {
  name: string;
  /**
   * Row-major, indexed by row number − 1, so row 3 is always at index 2 even
   * when rows 1–2 were never written. Absent rows are empty arrays; a short
   * row is short rather than padded, and every consumer already treats a
   * missing cell as `null`.
   */
  values: CellValue[][];
  /**
   * Formula text, sparse: row index → column index → `"=A2*3"`. Almost every
   * big sheet has none, so a dense parallel matrix would double the memory to
   * hold nothing.
   */
  formulas: Map<number, Map<number, string>>;
}

export interface ParsedWorkbook {
  sheets: ParsedSheet[];
  /** Cells held, for cache accounting. */
  cells: number;
  /**
   * False when formula **text** is approximate. The streaming reader flattens
   * a shared-formula follower cell (`<f t="shared" si="0"/>`) to an empty
   * formula, where the full loader reports `{ sharedFormula: "B2" }`. Values
   * are unaffected either way — only `read({ formulas: true })` cares, and it
   * re-reads exactly when this is false.
   */
  formulaTextExact: boolean;
}

/** What `WorkbookReader` actually yields; its .d.ts omits the sheet identity. */
type StreamedSheet = AsyncIterable<ExcelJS.Row> & { name?: string; id?: number };

function wrapParseError(path: string, e: unknown): Error {
  return new Error(
    `${path} could not be read as a workbook (${XLSX_HINT}): ${e instanceof Error ? e.message : String(e)}`,
  );
}

/**
 * Stream a workbook into flattened sheets.
 *
 * The bytes are handed in, never a path. `WorkbookReader` accepts a filename
 * and would open it off the **host** filesystem — the same class of escape the
 * `addImage` rewrite exists to close — so this signature only takes bytes, and
 * the only caller reads them through the guarded VFS handle.
 */
export async function streamWorkbook(bytes: Uint8Array, path: string): Promise<ParsedWorkbook> {
  const source = Readable.from([Buffer.from(bytes)]);
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(source, {
    worksheets: "emit",
    // Rich text and every shared string cell come from here.
    sharedStrings: "cache",
    // Required, and not the default. A date in xlsx is a number plus a date
    // number-format; with styles ignored the reader cannot tell the two apart
    // and a date cell reads back as the raw serial (45883 instead of
    // "2025-08-14T00:00:00.000Z").
    styles: "cache",
    // Left off deliberately. The hyperlink rels arrive after the sheet that
    // uses them, so caching them mostly does not populate in time; and a
    // hyperlink cell's *text* is in the cell either way, which is exactly what
    // `normalizeCell` reduces `{ text, hyperlink }` to.
    hyperlinks: "ignore",
    entries: "ignore",
  });

  const sheets: ParsedSheet[] = [];
  let cells = 0;
  let formulaTextExact = true;

  try {
    for await (const sheet of reader as AsyncIterable<StreamedSheet>) {
      const values: CellValue[][] = [];
      const formulas = new Map<number, Map<number, string>>();

      for await (const row of sheet) {
        const index = row.number - 1;
        const v: CellValue[] = [];
        let f: Map<number, string> | undefined;

        row.eachCell({ includeEmpty: true }, (cell, col) => {
          v[col - 1] = normalizeCell(cell.value);
          const text = cellFormula(cell.value);
          if (text === null) return;
          if (text === "=") {
            // A shared-formula follower: the text lives on the anchor cell and
            // the reader does not carry it across. Values are still right.
            formulaTextExact = false;
            return;
          }
          (f ??= new Map()).set(col - 1, text);
        });

        // `eachCell` skips holes, so a row with A and C set leaves B a hole
        // rather than a null. Records are built by index, and a hole reads as
        // `undefined` where every consumer expects `null`.
        for (let i = 0; i < v.length; i++) if (v[i] === undefined) v[i] = null;

        values[index] = v;
        if (f) formulas.set(index, f);
        cells += v.length;
      }

      for (let i = 0; i < values.length; i++) if (!values[i]) values[i] = [];
      sheets.push({ name: sheet.name ?? `Sheet${sheets.length + 1}`, values, formulas });
    }
  } catch (e) {
    throw wrapParseError(path, e);
  } finally {
    source.destroy();
  }

  return { sheets, cells, formulaTextExact };
}

/**
 * The full loader, kept for the two jobs streaming cannot do: giving `append`
 * a live workbook to mutate, and reporting exact formula text for a sheet that
 * uses shared formulas.
 */
export async function loadWorkbookModel(bytes: Uint8Array, path: string): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  } catch (e) {
    throw wrapParseError(path, e);
  }
  return wb;
}

/** Flatten a fully-loaded workbook — same output shape as {@link streamWorkbook}. */
export function flattenWorkbook(wb: ExcelJS.Workbook): ParsedWorkbook {
  const sheets: ParsedSheet[] = [];
  let cells = 0;
  for (const sheet of wb.worksheets) {
    const values: CellValue[][] = [];
    const formulas = new Map<number, Map<number, string>>();
    const width = sheet.columnCount;
    sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const index = rowNumber - 1;
      const v: CellValue[] = [];
      let f: Map<number, string> | undefined;
      for (let c = 1; c <= width; c++) {
        const cell = row.getCell(c);
        v.push(normalizeCell(cell.value));
        const text = cellFormula(cell.value);
        if (text !== null) (f ??= new Map()).set(c - 1, text);
      }
      values[index] = v;
      if (f) formulas.set(index, f);
      cells += v.length;
    });
    for (let i = 0; i < values.length; i++) if (!values[i]) values[i] = [];
    sheets.push({ name: sheet.name, values, formulas });
  }
  return { sheets, cells, formulaTextExact: true };
}

interface CacheEntry {
  /** `size:mtime` of the file the entry was built from. */
  fingerprint: string;
  /** When the parse finished — see the same-millisecond note in `read`. */
  parsedAt: number;
  workbook: ParsedWorkbook;
  lastUsed: number;
}

export interface SheetSource {
  /** Every sheet of `path`, flattened. Parsed once per (path, content). */
  read(path: string, needFormulaText?: boolean): Promise<ParsedWorkbook>;
  /** Forget `path` — call after anything that rewrites it. */
  drop(path: string): void;
  /** Test/bench hook: how many parses actually happened. */
  readonly stats: { parses: number; hits: number };
}

/**
 * Default cache budget, in cells.
 *
 * ~56 bytes per cached cell measured on the 100k × 6 fixture, so this is
 * roughly 55 MB per environment at full stretch — under a fifth of the 291 MB
 * that a *single* `wb.xlsx.load` of that same file transiently allocated
 * before this change. It holds the 100k-row sheet the issue names with room
 * for a second workbook beside it. Lower it on a host packing many
 * environments into one process.
 */
export const DEFAULT_CACHE_CELLS = 1_000_000;

/**
 * File size at which streaming starts paying, in bytes.
 *
 * Streaming is not free. Every xlsx exceljs writes — and every one Excel
 * writes — puts `sharedStrings.xml` after the sheets, and the streaming reader
 * answers that by spooling each sheet to a host temp file and reading it back,
 * because it cannot parse a sheet before the strings it refers to. That is a
 * fixed ~5ms a workbook, which a four-row sheet notices and a 100k-row sheet
 * does not.
 *
 * Measured on this host, six columns, time per parse and peak heap:
 *
 * ```
 *    500 rows /  25 KB   stream  22ms          load  20ms
 *   1000 rows /  44 KB   stream  35ms          load  38ms
 *   5000 rows / 210 KB   stream 141ms  26 MB   load 180ms   86 MB
 *  50000 rows /   2 MB   stream 1.9s   27 MB   load 2.4s   342 MB
 * ```
 *
 * The lines cross around 35 KB and the memory gap only widens after it, so
 * that is where the switch goes. Below it the full loader is used, which is
 * also the more faithful of the two — it is the one that carries shared
 * formulas — so a small workbook never needs the second parse either.
 */
export const DEFAULT_STREAM_BYTES = 32 * 1024;

export function createSheetSource(
  vfs: EnvFsHandle,
  maxCells = DEFAULT_CACHE_CELLS,
  streamBytes = DEFAULT_STREAM_BYTES,
): SheetSource {
  /** Insertion-ordered, so the first key is the least recently used. */
  const entries = new Map<string, CacheEntry>();
  let cached = 0;
  const stats = { parses: 0, hits: 0 };

  const drop = (path: string): void => {
    const entry = entries.get(path);
    if (!entry) return;
    cached -= entry.workbook.cells;
    entries.delete(path);
  };

  const store = (path: string, entry: CacheEntry): void => {
    drop(path);
    if (entry.workbook.cells > maxCells) return; // too big to hold; parse per call
    entries.set(path, entry);
    cached += entry.workbook.cells;
    while (cached > maxCells) {
      const oldest = entries.keys().next();
      if (oldest.done || oldest.value === path) break;
      drop(oldest.value);
    }
  };

  return {
    stats,

    async read(path: string, needFormulaText = false): Promise<ParsedWorkbook> {
      const stat = await vfs.stat(path);
      const fingerprint = stat ? `${stat.size}:${stat.mtime}` : null;

      if (fingerprint) {
        const hit = entries.get(path);
        if (hit && hit.fingerprint === fingerprint && (!needFormulaText || hit.workbook.formulaTextExact)) {
          hit.lastUsed = Date.now();
          // Refresh recency: re-inserting moves it to the end of the map.
          entries.delete(path);
          entries.set(path, hit);
          stats.hits++;
          return hit.workbook;
        }
      }

      // Through the guarded handle, always — zones, limits and history apply
      // to a read here exactly as they do anywhere else, and the streaming
      // reader never learns a host path.
      const bytes = await vfs.readBytes(path);

      stats.parses++;
      let workbook =
        bytes.byteLength >= streamBytes
          ? await streamWorkbook(bytes, path)
          : flattenWorkbook(await loadWorkbookModel(bytes, path));
      if (needFormulaText && !workbook.formulaTextExact) {
        // Shared formulas: only the full loader carries the anchor across.
        stats.parses++;
        workbook = flattenWorkbook(await loadWorkbookModel(bytes, path));
      }
      const parsedAt = Date.now();

      // `mtime` has millisecond resolution, so a file written in the same
      // millisecond the parse finished cannot be told apart from one written
      // just before it. Refusing to cache that case costs a re-parse of a file
      // small enough to parse inside a millisecond, and removes the only way
      // this cache could serve a stale row.
      if (fingerprint && stat && stat.mtime < parsedAt) {
        store(path, { fingerprint, parsedAt, workbook, lastUsed: parsedAt });
      }
      return workbook;
    },

    drop,
  };
}

/** The sheet named (or numbered) by the caller, with the same errors as before. */
export function pickParsedSheet(
  wb: ParsedWorkbook,
  want: string | number | undefined,
  path: string,
): ParsedSheet {
  const names = wb.sheets.map((s) => s.name);
  if (names.length === 0) throw new Error(`${path} has no sheets`);
  if (want === undefined) return wb.sheets[0];
  if (typeof want === "number") {
    const sheet = wb.sheets[want - 1];
    if (!sheet) {
      throw new Error(`${path} has no sheet #${want} — it has ${names.length} (${names.join(", ")}); indexes are 1-based`);
    }
    return sheet;
  }
  const sheet = wb.sheets.find((s) => s.name === want);
  if (!sheet) throw new Error(`${path} has no sheet named ${JSON.stringify(want)} — available: ${names.join(", ")}`);
  return sheet;
}
