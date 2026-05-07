/**
 * Tiny adapter contract for embedding generation. Consumers plug in whatever
 * provider they want (`text-embedding-3-small`, Voyage, Cohere, ...) without
 * the package taking on a model dependency. Used by episodic and (optionally)
 * resources semantic search.
 *
 * Embedding *generation* is intentionally out-of-band — adapters mark records
 * with `embeddingStatus: "missing" | "stale"` on write and a separate refresh
 * process (typically a Station — https://station.dterminal.net — signal) calls `embed` and writes vectors back
 * via `setEmbedding`. This keeps writes fast and decouples embedding cost
 * from the curator's hot path.
 */
export interface EmbeddingAdapter {
  /** Number of components in vectors returned by `embed`. Adapters must reject vectors with mismatched dimensions on `setEmbedding`. */
  dimensions: number;
  /** Embed a batch of texts. Order of returned vectors matches the input. */
  embed(texts: string[]): Promise<number[][]>;
}
