/**
 * Minimal RFC4180 CSV, kept local rather than reached for from `env:std`:
 * that module lives inside the sandbox and is not importable from host-side
 * adapter code.
 */
import type { CellValue } from "./cells";

export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const pushRow = () => {
    row.push(field);
    field = "";
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"' && field === "") {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === delimiter) {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (c === "\r") {
      i += 1;
      continue;
    }
    if (c === "\n") {
      pushRow();
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  if (field !== "" || row.length > 0) pushRow();
  return rows;
}

function csvField(v: CellValue, delimiter: string): string {
  const s = v === null || v === undefined ? "" : String(v);
  return s.includes('"') || s.includes(delimiter) || s.includes("\n") || s.includes("\r")
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

export function toCsvText(rows: CellValue[][], delimiter: string): string {
  return rows.map((r) => r.map((v) => csvField(v, delimiter)).join(delimiter)).join("\n") + "\n";
}
