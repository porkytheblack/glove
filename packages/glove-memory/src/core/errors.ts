/**
 * Base class for all memory adapter errors. Adapters throw typed subclasses
 * so callers — particularly the tool wrappers — can branch on `code`.
 */
export class MemoryError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "MemoryError";
    this.code = code;
  }
}

export class MemoryNotFoundError extends MemoryError {
  constructor(message?: string) {
    super("not_found", message);
    this.name = "MemoryNotFoundError";
  }
}

export type MemorySchemaErrorCode =
  | "unknown_class"
  | "unknown_relationship"
  | "unknown_kind"
  | "unknown_resource_root"
  | "schema_mismatch";

export class MemorySchemaError extends MemoryError {
  constructor(code: MemorySchemaErrorCode, message?: string) {
    super(code, message);
    this.name = "MemorySchemaError";
  }
}

export type MemoryQueryErrorCode = "invalid_query" | "operator_not_supported";

export class MemoryQueryError extends MemoryError {
  /** Operator name when `code === "operator_not_supported"`. */
  operator?: string;
  constructor(code: MemoryQueryErrorCode, message?: string, operator?: string) {
    super(code, message);
    this.name = "MemoryQueryError";
    this.operator = operator;
  }
}

export type MemoryWriteErrorCode =
  | "validation_failed"
  | "provenance_required"
  | "identity_ambiguous";

export class MemoryWriteError extends MemoryError {
  /**
   * For `identity_ambiguous`: the IDs of the existing nodes that matched
   * different identity-key sets in the same write. The orchestrator's
   * expected response is to merge them and retry the write.
   */
  matchedIds?: string[];
  constructor(code: MemoryWriteErrorCode, message?: string, matchedIds?: string[]) {
    super(code, message);
    this.name = "MemoryWriteError";
    this.matchedIds = matchedIds;
  }
}

export type EpisodicMemoryErrorCode =
  | "embedding_unavailable"
  | "semantic_search_unsupported"
  | "invalid_time_range";

export class EpisodicMemoryError extends MemoryError {
  constructor(code: EpisodicMemoryErrorCode, message?: string) {
    super(code, message);
    this.name = "EpisodicMemoryError";
  }
}

export type ResourceFsErrorCode =
  | "path_not_found"
  | "path_already_exists"
  | "not_a_directory"
  | "not_a_file"
  | "edit_string_not_unique"
  | "edit_string_not_found"
  | "binary_not_supported"
  | "invalid_path"
  | "invalid_range";

export class ResourceFsError extends MemoryError {
  constructor(code: ResourceFsErrorCode, message?: string) {
    super(code, message);
    this.name = "ResourceFsError";
  }
}

export type ContextErrorCode =
  | "entry_not_found"
  | "invalid_section"
  | "expired"
  | "render_failed";

export class ContextError extends MemoryError {
  constructor(code: ContextErrorCode, message?: string) {
    super(code, message);
    this.name = "ContextError";
  }
}
