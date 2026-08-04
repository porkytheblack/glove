/**
 * `env:spreadsheets` — exceljs bridged into the agent's virtual filesystem.
 *
 * Paths in, paths out. A script names a workbook in the tree, gets back plain
 * JSON records (never exceljs cell objects), and writes results to another
 * path. `describe()` summarises a workbook without pulling a single row into
 * the context window.
 */
import ExcelJS from "exceljs";
import { defineAdapter, defineBuilder, methodsOf, type EnvFsHandle, type FileSummary } from "glove-working-environment";
import { cellFormula, columnLetter, headerKeys, normalizeCell, trimRow, type CellValue } from "./cells";
import { parseCsv, toCsvText } from "./csv";
import { SPREADSHEETS_DOCS, SPREADSHEETS_TYPES } from "./docs";
import { SPREADSHEETS_SKILLS } from "./skills";

export type { CellValue };

export interface SheetSummary {
  name: string;
  rows: number;
  columns: number;
  /** Header row as read (first row by default), for orientation. */
  headers: string[];
  /** The first data row, so a model can see the shape without a read(). */
  sample: Record<string, CellValue> | null;
}

export interface WorkbookSummary extends FileSummary {
  format: "xlsx";
  sheets: SheetSummary[];
}

export interface ReadOptions {
  /** Sheet name, or 1-based index. Default: the first sheet. */
  sheet?: string | number;
  /** 1-based row holding the headers. Default 1. */
  headerRow?: number;
  /** Skip this many data rows. Default 0. */
  offset?: number;
  /** Return at most this many data rows. */
  limit?: number;
  /** Include a parallel `formulas` map for cells that carry one. */
  formulas?: boolean;
}

export interface ReadResult {
  sheet: string;
  headers: string[];
  rows: Array<Record<string, CellValue>>;
  /** Data rows in the sheet, ignoring offset/limit — so a script can page. */
  totalRows: number;
  /** Present only when `formulas: true` was requested. */
  formulas?: Array<Record<string, string>>;
}

export interface WriteOptions {
  /** Sheet name to create. Default "Sheet1". */
  sheet?: string;
  /** Column order (and header text) for record input. Default: keys of the first record. */
  headers?: string[];
  /** Write without a header row (raw-row input only). Default false. */
  noHeader?: boolean;
}

type RowInput = Array<Record<string, unknown>> | unknown[][];

const XLSX_HINT =
  "expected an .xlsx workbook — .xls (the old binary format) and Numbers/ODS files are not supported; convert first or use a CSV";

async function loadWorkbook(vfs: EnvFsHandle, path: string): Promise<ExcelJS.Workbook> {
  const bytes = await vfs.readBytes(path);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  } catch (e) {
    throw new Error(`${path} could not be read as a workbook (${XLSX_HINT}): ${e instanceof Error ? e.message : String(e)}`);
  }
  return wb;
}

function pickSheet(wb: ExcelJS.Workbook, want: string | number | undefined, path: string): ExcelJS.Worksheet {
  const names = wb.worksheets.map((w) => w.name);
  if (names.length === 0) throw new Error(`${path} has no sheets`);
  if (want === undefined) return wb.worksheets[0];
  if (typeof want === "number") {
    const sheet = wb.worksheets[want - 1];
    if (!sheet) throw new Error(`${path} has no sheet #${want} — it has ${names.length} (${names.join(", ")}); indexes are 1-based`);
    return sheet;
  }
  const sheet = wb.worksheets.find((w) => w.name === want);
  if (!sheet) throw new Error(`${path} has no sheet named ${JSON.stringify(want)} — available: ${names.join(", ")}`);
  return sheet;
}

/** Every row of a sheet as normalised scalars, padded to the used width. */
function sheetMatrix(sheet: ExcelJS.Worksheet): { values: CellValue[][]; formulas: Array<Array<string | null>> } {
  const values: CellValue[][] = [];
  const formulas: Array<Array<string | null>> = [];
  const width = sheet.columnCount;
  // eachRow skips empty rows entirely, so index by row number rather than by
  // iteration order or a gap silently shifts every row below it.
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const v: CellValue[] = [];
    const f: Array<string | null> = [];
    for (let c = 1; c <= width; c++) {
      const cell = row.getCell(c);
      v.push(normalizeCell(cell.value));
      f.push(cellFormula(cell.value));
    }
    values[rowNumber - 1] = v;
    formulas[rowNumber - 1] = f;
  });
  for (let i = 0; i < values.length; i++) {
    if (!values[i]) values[i] = new Array(width).fill(null);
    if (!formulas[i]) formulas[i] = new Array(width).fill(null);
  }
  return { values, formulas };
}

function isRecordRows(rows: RowInput): rows is Array<Record<string, unknown>> {
  return rows.length > 0 && !Array.isArray(rows[0]);
}

function buildSheet(wb: ExcelJS.Workbook, rows: RowInput, opts: WriteOptions): ExcelJS.Worksheet {
  const sheet = wb.addWorksheet(opts.sheet ?? "Sheet1");
  if (rows.length === 0) return sheet;
  if (isRecordRows(rows)) {
    const headers = opts.headers ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
    if (!opts.noHeader) sheet.addRow(headers);
    for (const record of rows) sheet.addRow(headers.map((h) => toCellInput(record[h])));
  } else {
    for (const row of rows as unknown[][]) sheet.addRow((row ?? []).map(toCellInput));
  }
  return sheet;
}

/**
 * Values arriving from a script are plain JSON. Dates have already become
 * ISO strings by then, so nothing needs special casing except `undefined`,
 * which exceljs would render as an empty *formula* cell.
 */
function toCellInput(v: unknown): CellValue {
  if (v === undefined || v === null) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  return JSON.stringify(v);
}

async function saveWorkbook(vfs: EnvFsHandle, wb: ExcelJS.Workbook, path: string): Promise<string> {
  const buffer = await wb.xlsx.writeBuffer();
  await vfs.writeFile(path, new Uint8Array(buffer as ArrayBuffer));
  return path;
}

/** Something with exceljs's `writeBuffer()` on it — `wb.xlsx` or `wb.csv`. */
interface Writer {
  writeBuffer(): Promise<ArrayBuffer | Buffer>;
}

/**
 * exceljs's `Workbook`, with its real API.
 *
 * `write(path, rows)` covers the common case in one call, and it should stay
 * — but it is our API, not exceljs's, and everything it does not cover (a
 * bold header, a number format, a merged title cell, a column width) is
 * unreachable through it. A model that knows exceljs already knows how to do
 * all of those; what it needs is the object, not a bigger options bag.
 *
 * The allowlist is read off live objects rather than typed out, so it is the
 * library's genuine surface and stays right when the dependency moves.
 */
function defineWorkbook(vfs: EnvFsHandle): unknown {
  const probe = new ExcelJS.Workbook();
  const sheet = probe.addWorksheet("probe");
  const row = sheet.addRow([1]);

  /** Write through the guarded handle, whatever format the writer is for. */
  const save = async (target: unknown, args: unknown[]): Promise<string> => {
    const first = args[0];
    const path = typeof first === "string" ? first : (first as { filename?: string } | undefined)?.filename;
    if (!path) {
      throw new Error("writeFile needs a path: await workbook.xlsx.writeFile('/out/report.xlsx')");
    }
    await vfs.writeFile(path, new Uint8Array(await bytesOf(target)));
    return path;
  };

  /**
   * A workbook is written through `wb.xlsx` or `wb.csv`, so that is what a
   * terminal is normally called on. `wb.writeFile(...)` is not the real API
   * but is an easy slip, and answering it costs nothing.
   */
  const bytesOf = async (target: unknown): Promise<ArrayBuffer | Buffer> => {
    const writer = target as Partial<Writer> & { xlsx?: Writer };
    if (typeof writer.writeBuffer === "function") return writer.writeBuffer();
    if (writer.xlsx && typeof writer.xlsx.writeBuffer === "function") return writer.xlsx.writeBuffer();
    throw new Error(
      "a workbook is written through its format: await workbook.xlsx.writeFile('/out/report.xlsx') " +
        "(or workbook.csv for CSV)",
    );
  };

  return defineBuilder<ExcelJS.Workbook>({
    name: "Workbook",
    construct: () => new ExcelJS.Workbook(),
    allow: [
      ...new Set([
        ...methodsOf(probe),
        ...methodsOf(sheet),
        ...methodsOf(row),
        ...methodsOf(row.getCell(1)),
        ...methodsOf(sheet.getColumn(1)),
        // Read through, not called: `workbook.xlsx.writeFile(...)`.
        "xlsx",
        "csv",
      ]),
    ],
    finish: {
      /**
       * exceljs's own `writeFile` writes to the HOST filesystem. It is
       * replaced rather than wrapped: the bytes are produced in memory and
       * land in the VFS through the guarded handle, so zones, limits and
       * versioning apply exactly as they do to any other write.
       */
      writeFile: save,
      /** `writeBuffer()` hands the bytes back instead of storing them. */
      async writeBuffer(target) {
        return new Uint8Array(await bytesOf(target));
      },
    },
  });
}

export const spreadsheets = () =>
  defineAdapter({
    name: "spreadsheets",
    description: "Read, write and summarise .xlsx workbooks; bridge sheets to and from CSV.",
    types: SPREADSHEETS_TYPES,
    docs: SPREADSHEETS_DOCS,
    skills: SPREADSHEETS_SKILLS,
    // No magic claim: XLSX is a ZIP and indistinguishable from DOCX by
    // signature. And no `.csv` claim either — a CSV is text, and the generic
    // "1,240 lines, here are the first five" summary tells a model more than
    // loading it as a one-sheet workbook would.
    handles: { extensions: [".xlsx", ".xlsm"] },
    create: (vfs: EnvFsHandle) => ({
      /**
       * exceljs's `Workbook`. Use it when the verbs below are not enough —
       * styling, number formats, merged cells, column widths, formulas.
       */
      Workbook: defineWorkbook(vfs),

      /** Structure of a workbook — sheet names, sizes, headers, one sample row. */
      async describe(path: string): Promise<WorkbookSummary> {
        const wb = await loadWorkbook(vfs, path);
        const sheets: SheetSummary[] = wb.worksheets.map((sheet) => {
          const { values } = sheetMatrix(sheet);
          const header = trimRow(values[0] ?? []);
          const headers = headerKeys(header);
          const first = values[1];
          const sample =
            first === undefined
              ? null
              : Object.fromEntries(headers.map((h, i) => [h, first[i] ?? null]));
          return {
            name: sheet.name,
            rows: Math.max(0, values.length - 1),
            columns: header.length,
            headers,
            sample,
          };
        });
        return {
          path,
          format: "xlsx",
          bytes: (await vfs.stat(path))?.size ?? 0,
          sheets,
        };
      },

      /** Sheet names, in workbook order. */
      async sheets(path: string): Promise<string[]> {
        const wb = await loadWorkbook(vfs, path);
        return wb.worksheets.map((w) => w.name);
      },

      /** A sheet as records keyed by its header row. */
      async read(path: string, opts: ReadOptions = {}): Promise<ReadResult> {
        const wb = await loadWorkbook(vfs, path);
        const sheet = pickSheet(wb, opts.sheet, path);
        const { values, formulas } = sheetMatrix(sheet);
        const headerIndex = (opts.headerRow ?? 1) - 1;
        if (headerIndex < 0) throw new Error(`headerRow is 1-based; got ${opts.headerRow}`);
        const headers = headerKeys(trimRow(values[headerIndex] ?? []));
        const body = values.slice(headerIndex + 1);
        const bodyFormulas = formulas.slice(headerIndex + 1);
        const offset = Math.max(0, opts.offset ?? 0);
        const end = opts.limit === undefined ? body.length : offset + Math.max(0, opts.limit);
        const window = body.slice(offset, end);

        const rows = window.map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? null])));
        const result: ReadResult = { sheet: sheet.name, headers, rows, totalRows: body.length };
        if (opts.formulas) {
          result.formulas = bodyFormulas.slice(offset, end).map((row) =>
            Object.fromEntries(
              headers.flatMap((h, i) => (row[i] ? [[h, row[i] as string]] : [])),
            ),
          );
        }
        return result;
      },

      /** A sheet as raw rows, header row included — for headerless data. */
      async readRows(path: string, opts: ReadOptions = {}): Promise<CellValue[][]> {
        const wb = await loadWorkbook(vfs, path);
        const sheet = pickSheet(wb, opts.sheet, path);
        const { values } = sheetMatrix(sheet);
        const offset = Math.max(0, opts.offset ?? 0);
        const end = opts.limit === undefined ? values.length : offset + Math.max(0, opts.limit);
        return values.slice(offset, end).map(trimRow);
      },

      /** Write records (or raw rows) to a new single-sheet workbook. */
      async write(path: string, rows: RowInput, opts: WriteOptions = {}): Promise<string> {
        const wb = new ExcelJS.Workbook();
        buildSheet(wb, rows ?? [], opts);
        return saveWorkbook(vfs, wb, path);
      },

      /** Write several named sheets at once. */
      async writeSheets(path: string, sheets: Record<string, RowInput>, opts: Omit<WriteOptions, "sheet"> = {}): Promise<string> {
        const wb = new ExcelJS.Workbook();
        const names = Object.keys(sheets ?? {});
        if (names.length === 0) throw new Error("writeSheets needs at least one sheet");
        for (const name of names) buildSheet(wb, sheets[name] ?? [], { ...opts, sheet: name });
        return saveWorkbook(vfs, wb, path);
      },

      /**
       * Append rows to an existing sheet, matching the existing header order.
       * Creates the workbook if it does not exist yet.
       */
      async append(path: string, rows: RowInput, opts: WriteOptions = {}): Promise<string> {
        if (!(await vfs.exists(path))) {
          const wb = new ExcelJS.Workbook();
          buildSheet(wb, rows ?? [], opts);
          return saveWorkbook(vfs, wb, path);
        }
        const wb = await loadWorkbook(vfs, path);
        const sheet = pickSheet(wb, opts.sheet, path);
        const list = rows ?? [];
        if (list.length === 0) return path;
        if (isRecordRows(list)) {
          const { values } = sheetMatrix(sheet);
          // Follow the sheet's own header order, not the record's key order —
          // appending a record whose keys happen to be ordered differently
          // must not scramble the columns.
          const headers = opts.headers ?? headerKeys(trimRow(values[0] ?? []));
          for (const record of list) sheet.addRow(headers.map((h) => toCellInput(record[h])));
        } else {
          for (const row of list as unknown[][]) sheet.addRow((row ?? []).map(toCellInput));
        }
        return saveWorkbook(vfs, wb, path);
      },

      /** Export one sheet to a CSV file. */
      async toCsv(input: string, output: string, opts: ReadOptions & { delimiter?: string } = {}): Promise<string> {
        const wb = await loadWorkbook(vfs, input);
        const sheet = pickSheet(wb, opts.sheet, input);
        const { values } = sheetMatrix(sheet);
        await vfs.writeFile(output, toCsvText(values.map(trimRow), opts.delimiter ?? ","));
        return output;
      },

      /** Import a CSV file as a single-sheet workbook. */
      async fromCsv(input: string, output: string, opts: WriteOptions & { delimiter?: string } = {}): Promise<string> {
        const rows = parseCsv(await vfs.readFile(input), opts.delimiter ?? ",");
        const wb = new ExcelJS.Workbook();
        const sheet = wb.addWorksheet(opts.sheet ?? "Sheet1");
        for (const row of rows) sheet.addRow(row);
        return saveWorkbook(vfs, wb, output);
      },
    }),
  });

export { columnLetter, normalizeCell };
export default spreadsheets;
