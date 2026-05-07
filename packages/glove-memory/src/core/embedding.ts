/**
 * Consumer-supplied adapter that turns text into vectors. The package
 * never imports a model SDK directly — bring your own (`text-embedding-3-small`,
 * Voyage, Cohere, ...). Generation runs out-of-band; see the embedding
 * lifecycle in `EpisodicMemoryAdapter`.
 */
export interface EmbeddingAdapter {
  embed(texts: string[]): Promise<number[][]>;
  /** Dimensions every returned vector must have. Storage backends rely on this for index setup. */
  dimensions: number;
}
