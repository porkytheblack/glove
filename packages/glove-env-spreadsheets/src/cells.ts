/**
 * Cell value normalisation.
 *
 * exceljs hands back rich objects — formula records, rich-text runs,
 * hyperlink pairs, error markers, Date instances. Passing those to a model
 * verbatim produces things like `{"richText":[{"font":{...},"text":"Q3"}]}`
 * where the answer was `"Q3"`: a burst of tokens that says nothing and
 * teaches the model to write defensive unwrapping code. Everything here
 * flattens to a plain JSON value, with the raw shape available only when
 * explicitly asked for.
 */

export type CellValue = string | number | boolean | null;

interface RichTextRun {
  text?: unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Flatten one exceljs cell value to a plain JSON scalar. */
export function normalizeCell(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();

  if (isRecord(value)) {
    // `{ error: '#DIV/0!' }` — keep the marker; it is the cell's real content.
    if (typeof value.error === "string") return value.error;
    // `{ formula, result }` / `{ sharedFormula, result }` — the result is what
    // the sheet displays. The formula itself is available via readFormulas.
    if ("result" in value) return normalizeCell(value.result);
    if ("formula" in value || "sharedFormula" in value) return null;
    // `{ richText: [{ text }, …] }`
    if (Array.isArray(value.richText)) {
      return (value.richText as RichTextRun[]).map((r) => (r?.text === undefined ? "" : String(r.text))).join("");
    }
    // `{ text, hyperlink }`
    if (typeof value.text === "string") return value.text;
    if (typeof value.hyperlink === "string") return value.hyperlink;
  }
  return String(value);
}

/** The formula behind a cell, if it has one. */
export function cellFormula(value: unknown): string | null {
  if (!isRecord(value)) return null;
  if (typeof value.formula === "string") return `=${value.formula}`;
  if (typeof value.sharedFormula === "string") return `=${value.sharedFormula}`;
  return null;
}

/**
 * Trim trailing empty cells from a row. Spreadsheets are routinely padded to
 * the used range, and a header row of `["a","b",null,null,null]` produces
 * records with `null` keys.
 */
export function trimRow(row: CellValue[]): CellValue[] {
  let end = row.length;
  while (end > 0 && (row[end - 1] === null || row[end - 1] === "")) end -= 1;
  return row.slice(0, end);
}

/**
 * Turn a header row into usable record keys: stringified, trimmed, blanks
 * filled with their column letter, duplicates suffixed. A record whose keys
 * silently collide loses columns.
 */
export function headerKeys(header: CellValue[]): string[] {
  const seen = new Map<string, number>();
  return header.map((cell, i) => {
    let key = cell === null ? "" : String(cell).trim();
    if (key === "") key = columnLetter(i + 1);
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    return n === 0 ? key : `${key}_${n + 1}`;
  });
}

/** 1 → A, 27 → AA. */
export function columnLetter(n: number): string {
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}
