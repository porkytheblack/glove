/**
 * Typed errors the adapters throw so callers (and tool wrappers) can branch
 * on `code` rather than parse messages. Tool wrappers convert these to
 * structured `ToolResultData` with `status: "error"` and a `message` the
 * model can reason over.
 */
export class MemoryError extends Error {
  code: string;
  details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "MemoryError";
    this.code = code;
    this.details = details;
  }
}

export class MemoryNotFoundError extends MemoryError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("not_found", message, details);
    this.name = "MemoryNotFoundError";
  }
}

export type MemorySchemaErrorCode =
  | "unknown_class"
  | "unknown_relationship"
  | "unknown_episode_kind"
  | "schema_mismatch";

export class MemorySchemaError extends MemoryError {
  declare code: MemorySchemaErrorCode;

  constructor(code: MemorySchemaErrorCode, message: string, details?: Record<string, unknown>) {
    super(code, message, details);
    this.name = "MemorySchemaError";
  }
}

export type MemoryQueryErrorCode = "invalid_query" | "operator_not_supported";

export class MemoryQueryError extends MemoryError {
  declare code: MemoryQueryErrorCode;

  constructor(code: MemoryQueryErrorCode, message: string, details?: Record<string, unknown>) {
    super(code, message, details);
    this.name = "MemoryQueryError";
  }
}

export type MemoryWriteErrorCode =
  | "validation_failed"
  | "provenance_required"
  | "identity_ambiguous";

export class MemoryWriteError extends MemoryError {
  declare code: MemoryWriteErrorCode;

  constructor(code: MemoryWriteErrorCode, message: string, details?: Record<string, unknown>) {
    super(code, message, details);
    this.name = "MemoryWriteError";
  }
}

export type EpisodicMemoryErrorCode =
  | "embedding_unavailable"
  | "semantic_search_unsupported"
  | "invalid_time_range";

export class EpisodicMemoryError extends MemoryError {
  declare code: EpisodicMemoryErrorCode;

  constructor(code: EpisodicMemoryErrorCode, message: string, details?: Record<string, unknown>) {
    super(code, message, details);
    this.name = "EpisodicMemoryError";
  }
}
