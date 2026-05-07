import type { ContextEntry } from "./types";

/**
 * Default markdown rendering for context injection. Groups entries by
 * section, renders titles as `### {title}`, and joins entry bodies with
 * blank lines. Used by the in-memory adapter and exposed for adapter
 * implementations that want the same shape.
 */
export function renderEntries(entries: ContextEntry[]): string {
  if (entries.length === 0) return "";

  const bySection = new Map<string, ContextEntry[]>();
  for (const entry of entries) {
    let bucket = bySection.get(entry.section);
    if (!bucket) {
      bucket = [];
      bySection.set(entry.section, bucket);
    }
    bucket.push(entry);
  }

  const lines: string[] = ["[User context]"];
  for (const [section, items] of bySection) {
    lines.push("");
    lines.push(`## ${formatSectionTitle(section)}`);
    for (const entry of items) {
      lines.push("");
      if (entry.title) {
        lines.push(`### ${entry.title}`);
      }
      lines.push(entry.content);
    }
  }
  return lines.join("\n");
}

function formatSectionTitle(section: string): string {
  // Convert snake_case / kebab-case to Title Case for nicer prompt output.
  return section
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Returns true when an entry has expired relative to `at` (defaults to now). */
export function isExpired(entry: ContextEntry, at: Date = new Date()): boolean {
  if (!entry.expiresAt) return false;
  const expiry = new Date(entry.expiresAt);
  if (Number.isNaN(expiry.getTime())) return false;
  return expiry.getTime() <= at.getTime();
}
