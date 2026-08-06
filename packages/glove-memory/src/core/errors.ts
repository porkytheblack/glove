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
  | "access_denied"
  | "path_not_found"
  | "path_already_exists"
  | "not_a_directory"
  | "not_a_file"
  | "directory_not_empty"
  | "edit_string_not_unique"
  | "edit_string_not_found"
  | "body_not_editable"
  | "binary_not_supported"
  | "semantic_search_unsupported"
  | "invalid_path"
  | "invalid_range";

export class ResourceFsError extends MemoryError {
  constructor(code: ResourceFsErrorCode, message?: string) {
    super(code, message);
    this.name = "ResourceFsError";
  }
}

/**
 * Raised when an access policy refuses a resource call — the path is outside
 * what the policy allows, or the operation needs a higher mode than the path
 * grants. Always a policy decision, never a storage failure: the same call
 * against the unwrapped adapter would have succeeded.
 */
export class ResourceAccessError extends ResourceFsError {
  /** The path that was refused. */
  path: string;
  /** The mode the operation needed. */
  required: "read" | "write";
  /** The mode the policy grants for `path`. */
  granted: "none" | "read" | "write";
  constructor(
    path: string,
    required: "read" | "write",
    granted: "none" | "read" | "write",
    message?: string,
  ) {
    super(
      "access_denied",
      message ??
        `Access denied: "${path}" is ${
          granted === "none" ? "not accessible" : `${granted}-only`
        } under the active access policy (needed: ${required}).`,
    );
    this.name = "ResourceAccessError";
    this.path = path;
    this.required = required;
    this.granted = granted;
  }
}

/**
 * Raised when a tool allowlist / denylist names a tool that isn't in the
 * surface it's filtering. A typo in a `deny` entry would otherwise silently
 * leave the tool registered — exactly the failure mode a denylist exists to
 * prevent — so unknown selectors are an error, not a no-op.
 */
export class MemoryToolSelectionError extends MemoryError {
  /** The selectors that matched nothing. */
  unknown: string[];
  /** The tool names that were available to match against. */
  available: string[];
  constructor(unknown: string[], available: string[], message?: string) {
    super(
      "unknown_tool",
      message ??
        `Unknown tool selector(s): ${unknown.map((u) => `"${u}"`).join(", ")}. Available: ${available.join(", ")}.`,
    );
    this.name = "MemoryToolSelectionError";
    this.unknown = unknown;
    this.available = available;
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

export type FormErrorCode =
  | "form_conflict"
  | "form_validation_failed"
  | "form_blocked"
  | "form_stale"
  /**
   * A definition the engine cannot run — colliding field ids, a gate that
   * throws, a repartition that never settles. Raised at compile or at commit,
   * never surfaced to the model as something it can fix.
   */
  | "form_definition_error";

export class FormError extends MemoryError {
  constructor(code: FormErrorCode, message?: string) {
    super(code, message);
    this.name = "FormError";
  }
}

/** Thrown by `commitInstance` when the instance moved under the caller. */
export class FormConflictError extends FormError {
  /** The version the caller expected. */
  expected: number;
  /** The version actually stored. */
  actual: number;
  constructor(expected: number, actual: number, message?: string) {
    super(
      "form_conflict",
      message ??
        `Form instance changed under the write (expected version ${expected}, found ${actual}).`,
    );
    this.name = "FormConflictError";
    this.expected = expected;
    this.actual = actual;
  }
}

export class FormDefinitionError extends FormError {
  /** The field / step / checkpoint ids at fault. */
  ids?: string[];
  constructor(message?: string, ids?: string[]) {
    super("form_definition_error", message);
    this.name = "FormDefinitionError";
    this.ids = ids;
  }
}

/** The registered def has moved past the version the instance pinned. */
export class FormStaleError extends FormError {
  instanceVersion: number;
  defVersion: number;
  constructor(instanceVersion: number, defVersion: number, message?: string) {
    super(
      "form_stale",
      message ??
        `Instance was started against def version ${instanceVersion}; the registered def is at ${defVersion}.`,
    );
    this.name = "FormStaleError";
    this.instanceVersion = instanceVersion;
    this.defVersion = defVersion;
  }
}

/** The instance is parked on a blocking checkpoint. */
export class FormBlockedError extends FormError {
  checkpointId: string;
  waitMessage?: string;
  constructor(checkpointId: string, waitMessage?: string) {
    super(
      "form_blocked",
      waitMessage ?? `Waiting on checkpoint "${checkpointId}".`,
    );
    this.name = "FormBlockedError";
    this.checkpointId = checkpointId;
    this.waitMessage = waitMessage;
  }
}
