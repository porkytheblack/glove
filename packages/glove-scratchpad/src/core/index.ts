/**
 * Core utilities shared by the database emulator: the backend contract, JSON→row
 * normalization, and SQL identifier hygiene. Backend-agnostic — bring a backend
 * that satisfies {@link ScratchpadBackend} (the default is `glove-sql`'s
 * `MemoryBackend`).
 */
export type { ColumnType, BackendResult, ScratchpadBackend } from "./types";

export {
  planNormalization,
  coerceForInsert,
  RID,
  PARENT,
  IDX,
  type NormalizationPlan,
  type NormTable,
  type NormColumn,
} from "./normalize";

export { sanitizeIdent, quoteIdent, childTableName, uniqueRef, uniqueColumn } from "./keys";
