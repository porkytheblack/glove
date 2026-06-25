import type { McpCatalogueEntry } from "../adapter";

/**
 * Rank catalogue entries against a free-text query + optional tag filter.
 *
 * Scores by WORD overlap, not whole-string containment. A multi-word query like
 * "customer accounts CRM" matches an entry whose name/description/tags contain
 * any of those words — ranked by how many match, weighted by word length — with
 * a bonus when the full phrase appears contiguously. Plain `haystack.includes(q)`
 * on the whole query string misses almost every multi-word query (the phrase is
 * rarely contiguous in the haystack), which silently starves discovery: the
 * subagent reports "no match" and the agent proceeds with fewer providers.
 *
 * Returns the top 10 matches, highest score first.
 */
export function matchEntries(
  entries: McpCatalogueEntry[],
  query: string | undefined,
  tags: string[] | undefined,
): McpCatalogueEntry[] {
  const q = (query ?? "").trim().toLowerCase();
  const words = q.split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
  const tagFilter = (tags ?? []).map((t) => t.toLowerCase());

  const scored: Array<{ entry: McpCatalogueEntry; score: number }> = [];
  for (const entry of entries) {
    const entryTags = (entry.tags ?? []).map((t) => t.toLowerCase());

    if (tagFilter.length) {
      const tagsMatch = tagFilter.every((t) => entryTags.includes(t));
      if (!tagsMatch) continue;
    }

    const haystack =
      `${entry.name} ${entry.description} ${entryTags.join(" ")}`.toLowerCase();

    if (!words.length) {
      scored.push({ entry, score: 1 }); // no query → tag-filtered (or all) listing
      continue;
    }

    let score = 0;
    for (const w of words) if (haystack.includes(w)) score += w.length;
    if (q.length >= 2 && haystack.includes(q)) score += q.length; // contiguous-phrase bonus
    if (score > 0) scored.push({ entry, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 10).map((s) => s.entry);
}
