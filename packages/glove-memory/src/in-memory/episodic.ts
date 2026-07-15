import { z } from "zod";
import {
  EpisodicMemoryError,
  MemoryNotFoundError,
  MemorySchemaError,
  MemoryWriteError,
} from "../core/errors";
import type { EmbeddingAdapter } from "../core/embedding";
import type { Provenance } from "../core/provenance";
import type { MemorySchema } from "../core/schema";
import type { EpisodicMemoryAdapter } from "../episodic/adapter";
import {
  occurredAtEnd,
  occurredAtStart,
  type Episode,
  type EpisodeInput,
  type EpisodeListOpts,
  type EpisodePatch,
  type EpisodeQuerySpec,
  type EpisodeSearchResult,
  type SemanticSearchOpts,
} from "../episodic/types";
import {
  FILTER_OP_KEYS,
  getFilterOpKey,
  type FilterOp,
  type NodeFilter,
} from "../entity/query";

interface InMemoryEpisodicOpts {
  schema: MemorySchema;
  identifier?: string;
  /**
   * Optional embedder. When provided, `searchEpisodes` runs vector cosine
   * similarity and `supportsSemanticSearch` is true.
   */
  embedder?: EmbeddingAdapter;
  /**
   * Enable in-process fuzzy (lexical) search over episode content when no
   * `embedder` is supplied. Turns on `searchEpisodes` — and therefore the
   * `glove_episodic_search` reader tool — with zero external services, no
   * embedding vectors, and no out-of-band embed loop. Ignored when `embedder`
   * is set (vector search takes precedence).
   */
  fuzzySearch?: boolean;
}

/**
 * Reference in-process adapter for episodic memory. Stores episodes in a
 * Map keyed by id; supports the structured query DSL with linear scans.
 *
 * **Stale marking is content-only.** `updateEpisode` flips
 * `embeddingStatus: "stale"` and drops the cached vector only when the
 * `content` field changes — the spec is silent on whether kind / participant
 * / property / occurredAt updates should invalidate embeddings, and the
 * embedding represents `content`. If a consumer wants every patch to
 * re-embed they can delete the episode and re-record it, or extend this
 * class.
 *
 * **Recency blend uses a 30-day half-life.** `searchEpisodes` ranks by
 * `(1 - recencyWeight) * semanticScore + recencyWeight * recencyScore`
 * where `recencyScore = exp(-ln(2) * ageMs / halfLifeMs)` with
 * `halfLifeMs = 30 days`. Default `recencyWeight = 0.2`. Companion adapters
 * may pick different decay shapes; the spec only fixes the shape of the
 * blend, not the curve.
 *
 * **Search modes.** If an `EmbeddingAdapter` is supplied, `searchEpisodes`
 * runs naive cosine similarity over locally-stored vectors. With no embedder
 * but `fuzzySearch: true`, it instead runs in-process lexical matching
 * (exact-phrase, substring, and bigram-Dice fuzzy) over episode content — no
 * embeddings, no external service, no out-of-band embed loop. With neither,
 * `supportsSemanticSearch` is false and the search reader tool is not
 * registered. Both modes are naive linear scans — fine for tests; companion
 * adapters use proper vector or text indices.
 */
export class InMemoryEpisodicAdapter implements EpisodicMemoryAdapter {
  identifier: string;
  schema: MemorySchema;
  supportsSemanticSearch: boolean;

  private readonly episodes = new Map<string, Episode>();
  private readonly embeddings = new Map<string, number[]>();
  private readonly embedder?: EmbeddingAdapter;
  /** True when running in embedding-free fuzzy (lexical) search mode. */
  private readonly fuzzy: boolean;
  private nextId = 1;

  constructor(opts: InMemoryEpisodicOpts) {
    this.schema = opts.schema;
    this.identifier = opts.identifier ?? `in-memory-episodic-${Date.now()}`;
    this.embedder = opts.embedder;
    // Vector search wins when an embedder is present; otherwise fall back to
    // in-process fuzzy matching when the consumer opts in. Either one makes
    // `searchEpisodes` callable and registers the search reader tool.
    this.fuzzy = !opts.embedder && Boolean(opts.fuzzySearch);
    this.supportsSemanticSearch = Boolean(opts.embedder) || this.fuzzy;
  }

  // ─── Write ──────────────────────────────────────────────────────────────

  async recordEpisode(ep: EpisodeInput, provenance: Provenance): Promise<{ id: string }> {
    requireProvenance(provenance);
    this.validateKindAndProperties(ep.kind, ep.properties);
    validateOccurredAt(ep.occurredAt);

    const id = this.genId();
    const now = new Date().toISOString();
    this.episodes.set(id, {
      id,
      occurredAt: ep.occurredAt,
      content: ep.content,
      kind: ep.kind,
      participants: [...ep.participants],
      properties: ep.properties,
      embeddingStatus: "missing",
      createdAt: now,
      updatedAt: now,
      provenance: [provenance],
    });
    return { id };
  }

  async getEpisode(id: string): Promise<Episode | null> {
    const ep = this.episodes.get(id);
    return ep ? cloneEpisode(ep) : null;
  }

  async updateEpisode(id: string, patch: EpisodePatch, provenance: Provenance): Promise<void> {
    requireProvenance(provenance);
    const ep = this.episodes.get(id);
    if (!ep) throw new MemoryNotFoundError(`No episode with id "${id}".`);
    const newKind = patch.kind ?? ep.kind;
    const newProps = patch.properties ?? ep.properties;
    this.validateKindAndProperties(newKind, newProps);
    if (patch.occurredAt) validateOccurredAt(patch.occurredAt);

    let contentChanged = false;
    if (patch.content !== undefined && patch.content !== ep.content) {
      ep.content = patch.content;
      contentChanged = true;
    }
    if (patch.kind !== undefined) ep.kind = patch.kind;
    if (patch.participants !== undefined) ep.participants = [...patch.participants];
    if (patch.properties !== undefined) ep.properties = patch.properties;
    if (patch.occurredAt !== undefined) ep.occurredAt = patch.occurredAt;
    ep.updatedAt = new Date().toISOString();
    ep.provenance.push(provenance);
    if (contentChanged) {
      ep.embeddingStatus = "stale";
      this.embeddings.delete(id);
    }
  }

  async deleteEpisode(id: string, provenance: Provenance): Promise<void> {
    requireProvenance(provenance);
    if (!this.episodes.has(id)) {
      throw new MemoryNotFoundError(`No episode with id "${id}".`);
    }
    this.episodes.delete(id);
    this.embeddings.delete(id);
  }

  // ─── Query ──────────────────────────────────────────────────────────────

  async findEpisodes(spec: EpisodeQuerySpec): Promise<Episode[]> {
    const { where = {}, timeRange } = spec;
    const kindFilter = normaliseStringFilter(where.kind);
    const participantFilter = where.participantIds ? new Set(where.participantIds) : null;
    const propertyFilter = where.properties;

    let timeStart: number | undefined;
    let timeEnd: number | undefined;
    if (timeRange?.start) timeStart = new Date(timeRange.start).getTime();
    if (timeRange?.end) timeEnd = new Date(timeRange.end).getTime();
    if (timeStart !== undefined && timeEnd !== undefined && timeStart > timeEnd) {
      throw new EpisodicMemoryError("invalid_time_range", "timeRange.start must be <= timeRange.end.");
    }

    const matches: Episode[] = [];
    for (const ep of this.episodes.values()) {
      if (kindFilter && !kindFilter.has(ep.kind)) continue;
      if (participantFilter) {
        const participantHit = ep.participants.some((p) => participantFilter.has(p.entityId));
        if (!participantHit) continue;
      }
      if (timeStart !== undefined || timeEnd !== undefined) {
        const startMs = occurredAtStart(ep.occurredAt).getTime();
        const endMs = occurredAtEnd(ep.occurredAt).getTime();
        if (timeStart !== undefined && endMs < timeStart) continue;
        if (timeEnd !== undefined && startMs > timeEnd) continue;
      }
      if (propertyFilter && !matchesPropertyFilter(ep.properties ?? {}, propertyFilter)) {
        continue;
      }
      matches.push(ep);
    }

    sortEpisodes(matches, spec.orderBy ?? "occurredAt:desc");
    const offset = spec.offset ?? 0;
    const limit = spec.limit ?? matches.length;
    return matches.slice(offset, offset + limit).map(cloneEpisode);
  }

  async episodesForEntity(entityId: string, opts: EpisodeListOpts = {}): Promise<Episode[]> {
    const kindFilter = normaliseStringFilter(opts.kind);
    const matches: Episode[] = [];
    for (const ep of this.episodes.values()) {
      if (!ep.participants.some((p) => p.entityId === entityId)) continue;
      if (kindFilter && !kindFilter.has(ep.kind)) continue;
      matches.push(ep);
    }
    sortEpisodes(matches, opts.orderBy ?? "occurredAt:desc");
    const offset = opts.offset ?? 0;
    const limit = opts.limit ?? matches.length;
    return matches.slice(offset, offset + limit).map(cloneEpisode);
  }

  async episodesBetween(start: string, end: string, opts: EpisodeListOpts = {}): Promise<Episode[]> {
    return this.findEpisodes({
      timeRange: { start, end },
      orderBy: opts.orderBy ?? "occurredAt:asc",
      limit: opts.limit,
      offset: opts.offset,
      where: opts.kind ? { kind: opts.kind } : undefined,
    });
  }

  async replaceParticipantId(
    oldId: string,
    newId: string,
    provenance: Provenance,
  ): Promise<{ updated: number }> {
    requireProvenance(provenance);
    let updated = 0;
    const now = new Date().toISOString();
    for (const ep of this.episodes.values()) {
      let touched = false;
      ep.participants = ep.participants.map((p) => {
        if (p.entityId === oldId) {
          touched = true;
          return { ...p, entityId: newId };
        }
        return p;
      });
      if (touched) {
        ep.updatedAt = now;
        ep.provenance.push({ ...provenance, note: provenance.note ? `${provenance.note}; rewrote ${oldId}->${newId}` : `rewrote ${oldId}->${newId}` });
        updated++;
      }
    }
    return { updated };
  }

  // ─── Embedding lifecycle ────────────────────────────────────────────────

  async findEpisodesNeedingEmbedding(opts: { limit?: number } = {}): Promise<Array<{ id: string; content: string }>> {
    const out: Array<{ id: string; content: string }> = [];
    for (const ep of this.episodes.values()) {
      if (ep.embeddingStatus !== "fresh") {
        out.push({ id: ep.id, content: ep.content });
      }
      if (opts.limit && out.length >= opts.limit) break;
    }
    return out;
  }

  async setEmbedding(id: string, vector: number[]): Promise<void> {
    const ep = this.episodes.get(id);
    if (!ep) throw new MemoryNotFoundError(`No episode with id "${id}".`);
    if (this.embedder && vector.length !== this.embedder.dimensions) {
      throw new EpisodicMemoryError(
        "embedding_unavailable",
        `Vector length ${vector.length} does not match embedder dimensions ${this.embedder.dimensions}.`,
      );
    }
    this.embeddings.set(id, [...vector]);
    ep.embeddingStatus = "fresh";
  }

  // ─── Semantic search ────────────────────────────────────────────────────

  async searchEpisodes(query: string, opts: SemanticSearchOpts = {}): Promise<EpisodeSearchResult[]> {
    if (!this.embedder && !this.fuzzy) {
      throw new EpisodicMemoryError(
        "semantic_search_unsupported",
        "This adapter was constructed without an EmbeddingAdapter and without fuzzySearch enabled.",
      );
    }

    // Vector mode needs a query embedding up front; fuzzy mode scores lexically.
    let queryVec: number[] | undefined;
    if (this.embedder) {
      [queryVec] = await this.embedder.embed([query]);
      if (!queryVec) {
        throw new EpisodicMemoryError("embedding_unavailable", "Embedder returned no vector for the query.");
      }
    }
    const normalisedQuery = query.trim().toLowerCase();
    const queryTokens = this.fuzzy ? tokenize(query) : [];

    const limit = opts.limit ?? 5;
    const recencyWeight = clamp(opts.recencyWeight ?? 0.2, 0, 1);

    const filter = opts.filter ?? {};
    const kindFilter = normaliseStringFilter(filter.kind);
    const participantFilter = filter.participantIds ? new Set(filter.participantIds) : null;
    let timeStart: number | undefined;
    let timeEnd: number | undefined;
    if (filter.timeRange?.start) timeStart = new Date(filter.timeRange.start).getTime();
    if (filter.timeRange?.end) timeEnd = new Date(filter.timeRange.end).getTime();

    const now = Date.now();
    // Time-decay denominator: half-life of 30 days for the recency component.
    const halfLifeMs = 30 * 24 * 60 * 60 * 1000;

    const candidates: EpisodeSearchResult[] = [];
    for (const ep of this.episodes.values()) {
      // Structural filters are cheap — apply them before scoring.
      if (kindFilter && !kindFilter.has(ep.kind)) continue;
      if (participantFilter && !ep.participants.some((p) => participantFilter.has(p.entityId))) continue;
      if (timeStart !== undefined || timeEnd !== undefined) {
        const startMs = occurredAtStart(ep.occurredAt).getTime();
        const endMs = occurredAtEnd(ep.occurredAt).getTime();
        if (timeStart !== undefined && endMs < timeStart) continue;
        if (timeEnd !== undefined && startMs > timeEnd) continue;
      }

      let semanticScore: number;
      let distance: number;
      if (this.embedder) {
        // Vector mode: only episodes with a fresh embedding are candidates.
        if (ep.embeddingStatus !== "fresh") continue;
        const vec = this.embeddings.get(ep.id);
        if (!vec) continue;
        distance = cosineDistance(queryVec!, vec);
        semanticScore = 1 - distance;
      } else {
        // Fuzzy mode: lexical similarity over content, no embeddings required.
        semanticScore = lexicalScore(normalisedQuery, queryTokens, ep.content);
        if (semanticScore <= 0) continue;
        distance = 1 - semanticScore;
      }

      const ageMs = Math.max(0, now - occurredAtEnd(ep.occurredAt).getTime());
      const recencyScore = Math.exp(-Math.LN2 * (ageMs / halfLifeMs));

      const score =
        (1 - recencyWeight) * semanticScore + recencyWeight * recencyScore;

      candidates.push({ episode: cloneEpisode(ep), score, distance });
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, limit);
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  private genId(): string {
    const id = `ep_${this.nextId.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    this.nextId++;
    return id;
  }

  private validateKindAndProperties(kind: string, properties: Record<string, unknown> | undefined): void {
    const def = this.schema.getEpisodeKind(kind);
    if (!def) {
      throw new MemorySchemaError("unknown_kind", `Unknown episode kind: "${kind}".`);
    }
    if (def.propertiesSchema && properties !== undefined) {
      const parsed = def.propertiesSchema.safeParse(properties);
      if (!parsed.success) {
        throw new MemoryWriteError(
          "validation_failed",
          `Episode property validation failed for kind "${kind}": ${JSON.stringify(z.treeifyError(parsed.error))}`,
        );
      }
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function requireProvenance(p: Provenance | undefined): asserts p is Provenance {
  if (!p || typeof p !== "object" || typeof p.source !== "string" || typeof p.actor !== "string" || typeof p.timestamp !== "string") {
    throw new MemoryWriteError("provenance_required", "A provenance record is required on every write.");
  }
}

function validateOccurredAt(value: Episode["occurredAt"]): void {
  if (typeof value === "string") {
    if (Number.isNaN(new Date(value).getTime())) {
      throw new MemoryWriteError("validation_failed", `Invalid occurredAt: "${value}" is not a parseable ISO 8601 string.`);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    throw new MemoryWriteError("validation_failed", "occurredAt must be a string or { start, end } interval.");
  }
  const startMs = new Date(value.start).getTime();
  const endMs = new Date(value.end).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    throw new MemoryWriteError("validation_failed", "occurredAt interval must contain parseable ISO 8601 strings.");
  }
  if (startMs > endMs) {
    throw new MemoryWriteError("validation_failed", "occurredAt.start must be <= occurredAt.end.");
  }
}

function cloneEpisode(ep: Episode): Episode {
  return {
    ...ep,
    participants: ep.participants.map((p) => ({ ...p })),
    properties: ep.properties ? { ...ep.properties } : undefined,
    provenance: [...ep.provenance],
  };
}

function normaliseStringFilter(v: string | string[] | undefined): Set<string> | null {
  if (!v) return null;
  if (typeof v === "string") return new Set([v]);
  return new Set(v);
}

function sortEpisodes(eps: Episode[], orderBy: NonNullable<EpisodeQuerySpec["orderBy"]>): void {
  const [field, dir] = orderBy.split(":") as ["occurredAt" | "createdAt", "asc" | "desc"];
  const factor = dir === "desc" ? -1 : 1;
  eps.sort((a, b) => {
    const av = field === "occurredAt"
      ? occurredAtStart(a.occurredAt).getTime()
      : new Date(a.createdAt).getTime();
    const bv = field === "occurredAt"
      ? occurredAtStart(b.occurredAt).getTime()
      : new Date(b.createdAt).getTime();
    return (av - bv) * factor;
  });
}

function matchesPropertyFilter(props: Record<string, unknown>, filter: NodeFilter): boolean {
  for (const [name, opOrOps] of Object.entries(filter)) {
    const ops = Array.isArray(opOrOps) ? opOrOps : [opOrOps];
    for (const op of ops) {
      if (!evalOp(props, name, op)) return false;
    }
  }
  return true;
}

function evalOp(props: Record<string, unknown>, name: string, op: FilterOp): boolean {
  const value = props[name];
  const key = getFilterOpKey(op);
  switch (key) {
    case "eq": return deepEqual(value, (op as { eq: unknown }).eq);
    case "neq": return !deepEqual(value, (op as { neq: unknown }).neq);
    case "in": return (op as { in: unknown[] }).in.some((v) => deepEqual(value, v));
    case "not_in": return !(op as { not_in: unknown[] }).not_in.some((v) => deepEqual(value, v));
    case "exists": {
      const want = (op as { exists: boolean }).exists;
      return want === (value !== undefined && value !== null);
    }
    case "fuzzy":
    case "contains": {
      const needle = (op as Record<"fuzzy" | "contains", string>)[key];
      return typeof value === "string" && value.toLowerCase().includes(needle.toLowerCase());
    }
    case "starts_with": {
      const needle = (op as { starts_with: string }).starts_with;
      return typeof value === "string" && value.toLowerCase().startsWith(needle.toLowerCase());
    }
    case "ends_with": {
      const needle = (op as { ends_with: string }).ends_with;
      return typeof value === "string" && value.toLowerCase().endsWith(needle.toLowerCase());
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const target = (op as Record<string, number | string>)[key];
      return numericOrLexCompare(value, target, key);
    }
    case "between": {
      const [lo, hi] = (op as { between: [unknown, unknown] }).between;
      return numericOrLexCompare(value, lo, "gte") && numericOrLexCompare(value, hi, "lte");
    }
  }
  return false;
}

function numericOrLexCompare(value: unknown, target: unknown, op: "gt" | "gte" | "lt" | "lte"): boolean {
  if (value === undefined || value === null) return false;
  let cmp = 0;
  if (typeof value === "number" && typeof target === "number") cmp = value - target;
  else cmp = String(value).localeCompare(String(target));
  switch (op) {
    case "gt": return cmp > 0;
    case "gte": return cmp >= 0;
    case "lt": return cmp < 0;
    case "lte": return cmp <= 0;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  if (ak.length !== Object.keys(bo).length) return false;
  for (const k of ak) {
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  return true;
}

function cosineDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    // Mismatched dims — treat as maximally distant.
    return 1;
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 1;
  const sim = dot / (Math.sqrt(na) * Math.sqrt(nb));
  return 1 - sim;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ─── Fuzzy (lexical) search helpers ────────────────────────────────────────

/**
 * Lexical similarity of a query to an episode's content, in [0, 1]. The fuzzy
 * search mode uses this as a drop-in replacement for cosine similarity.
 *
 * - An exact (case-insensitive) phrase hit scores 1.
 * - Otherwise the score is the mean over query tokens of each token's best
 *   match against the content's tokens: an exact token match scores 1, a
 *   substring match (stems like license/licensing) scores at least 0.85, and
 *   everything else falls back to a bigram Dice coefficient so typos and
 *   shared stems still register — but only above `FUZZY_TOKEN_MIN`, so
 *   unrelated words (which still share a few incidental bigrams) score 0 and
 *   genuinely irrelevant episodes are excluded entirely.
 *
 * `normalisedQuery` is the lowercased, trimmed query; `queryTokens` its word
 * tokens — both precomputed once by the caller so this stays cheap in the
 * per-episode loop.
 */
function lexicalScore(normalisedQuery: string, queryTokens: string[], content: string): number {
  if (!normalisedQuery) return 0;
  const haystack = content.toLowerCase();
  if (haystack.includes(normalisedQuery)) return 1;
  if (queryTokens.length === 0) return 0;
  const contentTokens = Array.from(new Set(tokenize(content)));
  if (contentTokens.length === 0) return 0;

  let total = 0;
  for (const qt of queryTokens) {
    let best = 0;
    for (const ct of contentTokens) {
      let sim: number;
      if (ct === qt) {
        sim = 1;
      } else if (Math.min(qt.length, ct.length) >= 3 && (ct.includes(qt) || qt.includes(ct))) {
        sim = Math.max(0.85, diceCoefficient(qt, ct));
      } else {
        const dice = diceCoefficient(qt, ct);
        sim = dice >= FUZZY_TOKEN_MIN ? dice : 0;
      }
      if (sim > best) best = sim;
      if (best === 1) break;
    }
    total += best;
  }
  return total / queryTokens.length;
}

/**
 * Minimum bigram-Dice similarity for a fuzzy token match to count. Below this,
 * two tokens are treated as unrelated (score 0). Tuned so common typos
 * (licensing/licencing ≈ 0.75, compliance/complaince ≈ 0.67) still match while
 * incidental bigram overlap between unrelated words does not.
 */
const FUZZY_TOKEN_MIN = 0.6;

/** Lowercase alphanumeric word tokens. */
function tokenize(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/**
 * Sørensen–Dice coefficient over character bigrams — a cheap, dependency-free
 * string similarity in [0, 1] that tolerates typos and shared stems.
 */
function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigramsA = bigrams(a);
  const counts = new Map<string, number>();
  for (const g of bigramsA) counts.set(g, (counts.get(g) ?? 0) + 1);
  const bigramsB = bigrams(b);
  let intersection = 0;
  for (const g of bigramsB) {
    const c = counts.get(g);
    if (c && c > 0) {
      counts.set(g, c - 1);
      intersection++;
    }
  }
  return (2 * intersection) / (bigramsA.length + bigramsB.length);
}

/** Overlapping character bigrams of a string. */
function bigrams(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

void FILTER_OP_KEYS;
