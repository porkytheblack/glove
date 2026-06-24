/**
 * Core of the Scratchpad Computer: the store, the descriptor economy, and the
 * Postgres-dialect backend contract. Backend-agnostic — no SQL engine ships
 * here; bring one that satisfies {@link ScratchpadBackend} (e.g.
 * `glove-scratchpad/pglite`).
 */
export type {
  Reference,
  Provenance,
  ColumnType,
  ColumnDescriptor,
  TableDescriptor,
  Descriptor,
  Stub,
  BackendResult,
  ScratchpadBackend,
} from "./types";

export {
  Scratchpad,
  type IngestOptions,
  type QueryOptions,
  type QueryRows,
  type MaterializeOptions,
  type MaterializeResult,
} from "./scratchpad";

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

export {
  pgTypeToColumnType,
  readRawColumns,
  toColumnDescriptors,
  readRowCount,
  readPreview,
} from "./descriptor";

export { sanitizeIdent, quoteIdent, childTableName, uniqueRef } from "./keys";
