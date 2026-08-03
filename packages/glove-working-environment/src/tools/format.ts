/**
 * Response shaping shared by the verbs: numbered file listings, byte
 * formatting, serialization of script results, and the truncate-with-
 * spillover discipline that keeps big data in files instead of context.
 */
import { inspect } from "node:util";
import type { EnvLimits } from "../types";
import { EnvLimitError } from "../types";
import type { EnvCore } from "../core/env";

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

export function fmtCount(n: number): string {
  return n.toLocaleString("en-US");
}

/** JSON when possible, util.inspect-style otherwise. */
export function serializeResult(value: unknown): string {
  if (value === undefined) return "undefined";
  try {
    const json = JSON.stringify(value, null, 2);
    if (json !== undefined) return json;
  } catch {
    // fall through to inspect (cycles, BigInt, …)
  }
  return inspect(value, { depth: 5, breakLength: 100, maxArrayLength: 200 });
}

const MAX_LINE_CHARS = 2_000;

export function clipLine(line: string): string {
  return line.length <= MAX_LINE_CHARS ? line : `${line.slice(0, MAX_LINE_CHARS)}… [+${fmtCount(line.length - MAX_LINE_CHARS)} chars]`;
}

export interface TruncatedText {
  text: string;
  truncated: boolean;
  totalLines: number;
  shownLines: number;
}

/**
 * Cap a block of text by the response line AND byte budget.
 *
 * Clipping a single over-long line still counts as truncation: a 5 MB
 * one-liner has no newlines, so a purely line-counting budget would report
 * "not truncated" and the caller would silently drop the remainder instead of
 * spilling it to a file.
 */
export function truncateText(full: string, limits: EnvLimits, budgetShare = 1): TruncatedText {
  const maxLines = Math.max(10, Math.floor(limits.maxToolResponseLines * budgetShare));
  const maxBytes = Math.max(1_000, Math.floor(limits.maxToolResponseBytes * budgetShare));
  const lines = full.split("\n");
  const kept: string[] = [];
  let bytes = 0;
  let clipped = false;
  for (const raw of lines) {
    const line = clipLine(raw);
    if (line.length !== raw.length) clipped = true;
    if (kept.length >= maxLines || bytes + line.length > maxBytes) {
      return { text: kept.join("\n"), truncated: true, totalLines: lines.length, shownLines: kept.length };
    }
    kept.push(line);
    bytes += line.length + 1;
  }
  return { text: kept.join("\n"), truncated: clipped, totalLines: lines.length, shownLines: kept.length };
}

/**
 * Hard byte ceiling for any string handed to the model, applied after
 * per-verb shaping so no response path can exceed the budget.
 */
export function capResponse(text: string, limits: EnvLimits, budgetShare = 1): string {
  const maxBytes = Math.max(1_000, Math.floor(limits.maxToolResponseBytes * budgetShare));
  if (text.length <= maxBytes) return text;
  return `${text.slice(0, maxBytes)}\n… [response truncated at ${fmtCount(maxBytes)} chars (limits.maxToolResponseBytes)]`;
}

const SPILL_CAP_BYTES = 8 * 1024 * 1024;

/**
 * Truncate `full` for the response; when it overflows, write the complete
 * text to `spillPath` and append the "… written to" tail the spec calls for.
 */
export async function withSpillover(
  core: EnvCore,
  full: string,
  spillPath: string,
  limits: EnvLimits,
  budgetShare = 1,
): Promise<{ text: string; spilled: string | null }> {
  const t = truncateText(full, limits, budgetShare);
  if (!t.truncated) return { text: t.text, spilled: null };
  let spillNote: string;
  let spilled: string | null = null;
  try {
    let content = full;
    if (content.length > SPILL_CAP_BYTES || content.length > limits.maxFileBytes) {
      const cap = Math.min(SPILL_CAP_BYTES, limits.maxFileBytes);
      content = content.slice(0, cap) + "\n… [spill truncated]\n";
    }
    await core.write(spillPath, content);
    spilled = spillPath;
    spillNote = `… [${fmtCount(t.totalLines - t.shownLines)} more lines — written to ${spillPath}]`;
  } catch (e) {
    const msg = e instanceof EnvLimitError ? e.message : e instanceof Error ? e.message : String(e);
    spillNote = `… [${fmtCount(t.totalLines - t.shownLines)} more lines — could not spill to ${spillPath}: ${msg}]`;
  }
  return { text: `${t.text}\n${spillNote}`, spilled };
}

/** cat -n style numbering for read_file. */
export function numberLines(lines: string[], startLine: number): string {
  const width = String(startLine + lines.length - 1).length;
  return lines.map((l, i) => `${String(startLine + i).padStart(width)}\t${clipLine(l)}`).join("\n");
}
