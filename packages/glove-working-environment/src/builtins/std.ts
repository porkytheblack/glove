/**
 * `env:std` — a small zero-dependency battery: JSON helpers, CSV
 * parse/stringify, text utilities, and byte/base64 bridging. Anything
 * heavier is opt-in via stdlib adapters.
 */

export const STD_DESCRIPTION =
  "Zero-dep battery: json.parse/stringify, csv.parse/rows/stringify, text utilities, base64/bytes bridging.";

// ------------------------------------------------------------------- json

const json = {
  parse(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`invalid JSON: ${msg}`);
    }
  },
  stringify(value: unknown, pretty: number | boolean = 2): string {
    const indent = pretty === true ? 2 : pretty === false ? undefined : pretty;
    return JSON.stringify(value, null, indent);
  },
};

// -------------------------------------------------------------------- csv

export interface CsvParseOptions {
  delimiter?: string;
}

export interface CsvStringifyOptions {
  delimiter?: string;
  /** Column order for records; defaults to the keys of the first row. */
  headers?: string[];
}

function parseCsvRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
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
      pushField();
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

function csvField(v: unknown, delimiter: string): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (s.includes('"') || s.includes(delimiter) || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const csv = {
  /**
   * Parse CSV text into records keyed by the header row.
   *
   * This always returns records — use {@link csv.rows} for headerless data.
   * A function whose return type depends on an option is a function a model
   * has to guess about, and it guesses wrong about half the time.
   */
  parse(text: string, opts?: CsvParseOptions): Array<Record<string, string>> {
    const delimiter = opts?.delimiter ?? ",";
    const rows = parseCsvRows(text, delimiter);
    const [header, ...rest] = rows;
    if (!header) return [];
    return rest.map((r) => {
      const rec: Record<string, string> = {};
      header.forEach((h, idx) => {
        rec[h] = r[idx] ?? "";
      });
      return rec;
    });
  },
  /** Parse CSV text into raw rows, header row included. */
  rows(text: string, opts?: CsvParseOptions): string[][] {
    return parseCsvRows(text, opts?.delimiter ?? ",");
  },
  stringify(rows: Array<Record<string, unknown>> | unknown[][], opts?: CsvStringifyOptions): string {
    const delimiter = opts?.delimiter ?? ",";
    if (rows.length === 0) return "";
    const lines: string[] = [];
    if (Array.isArray(rows[0])) {
      for (const r of rows as unknown[][]) lines.push(r.map((v) => csvField(v, delimiter)).join(delimiter));
    } else {
      const records = rows as Array<Record<string, unknown>>;
      const headers = opts?.headers ?? Object.keys(records[0]);
      lines.push(headers.map((h) => csvField(h, delimiter)).join(delimiter));
      for (const r of records) lines.push(headers.map((h) => csvField(r[h], delimiter)).join(delimiter));
    }
    return lines.join("\n") + "\n";
  },
};

// ------------------------------------------------------------------- text

const text = {
  lines(s: string): string[] {
    return s.split(/\r?\n/);
  },
  joinLines(lines: string[]): string {
    return lines.join("\n");
  },
  truncate(s: string, max: number, suffix = "…"): string {
    return s.length <= max ? s : s.slice(0, Math.max(0, max - suffix.length)) + suffix;
  },
  /**
   * Strip the common leading indentation from a block. Scripts build reports
   * with indented template literals constantly; without this every one of
   * them ships its own regex.
   */
  dedent(s: string): string {
    const lines = s.split("\n");
    let indent = Infinity;
    for (const line of lines) {
      if (line.trim() === "") continue;
      indent = Math.min(indent, line.length - line.trimStart().length);
    }
    if (!Number.isFinite(indent) || indent === 0) return s;
    return lines.map((l) => (l.trim() === "" ? l : l.slice(indent))).join("\n");
  },
};

// ------------------------------------------------------------------ bytes

const bytes = {
  fromText(s: string): Uint8Array {
    return new TextEncoder().encode(s);
  },
  toText(data: Uint8Array): string {
    return new TextDecoder().decode(data);
  },
  toBase64(data: Uint8Array): string {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("base64");
  },
  fromBase64(b64: string): Uint8Array {
    const buf = Buffer.from(b64, "base64");
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  },
};

export function createStdBindings(): Record<string, unknown> {
  return { json, csv, text, bytes };
}

export const STD_TYPES = `/** env:std — small zero-dep battery. */
export const json: {
  /** JSON.parse with a clearer error message. */
  parse(text: string): unknown;
  /** Pretty by default (2 spaces); pass false for compact. */
  stringify(value: unknown, pretty?: number | boolean): string;
};
export const csv: {
  /** Parse CSV using the first row as headers → array of records. */
  parse(text: string, opts?: { delimiter?: string }): Array<Record<string, string>>;
  /** Parse CSV into raw rows, header row included. */
  rows(text: string, opts?: { delimiter?: string }): string[][];
  /** Records (header row emitted) or raw rows. */
  stringify(rows: Array<Record<string, unknown>> | unknown[][], opts?: { delimiter?: string; headers?: string[] }): string;
};
export const text: {
  lines(s: string): string[];
  joinLines(lines: string[]): string;
  truncate(s: string, max: number, suffix?: string): string;
  /** Strip the common leading indentation from a block. */
  dedent(s: string): string;
};
export const bytes: {
  fromText(s: string): Uint8Array;
  toText(data: Uint8Array): string;
  toBase64(data: Uint8Array): string;
  fromBase64(b64: string): Uint8Array;
};
`;
