/**
 * One error type with a stable code, so a tool can tell the model what to do
 * next and the HTTP layer can pick a status without parsing messages.
 */

export type MiniAppErrorCode =
  /** No such app, method or output. */
  | "not_found"
  /** The caller may not do this. */
  | "forbidden"
  /** The definition, migration or arguments are wrong. Nothing ran. */
  | "invalid"
  /** The method threw, or a statement failed. An action's changes were reverted. */
  | "failed"
  /** A NOT NULL, UNIQUE or key rule failed. The action was reverted. */
  | "constraint"
  /** The method ran out of fuel or nested too deep. The action was reverted. */
  | "budget";

export class MiniAppError extends Error {
  constructor(
    readonly code: MiniAppErrorCode,
    message: string,
    readonly details?: string[],
  ) {
    super(message);
    this.name = "MiniAppError";
  }

  toJSON() {
    return { code: this.code, error: this.message, ...(this.details?.length ? { details: this.details } : {}) };
  }
}

export const isMiniAppError = (err: unknown, ...codes: MiniAppErrorCode[]): err is MiniAppError =>
  err instanceof MiniAppError && (codes.length === 0 || codes.includes(err.code));

export const HTTP_STATUS: Record<MiniAppErrorCode, number> = {
  not_found: 404,
  forbidden: 403,
  invalid: 422,
  failed: 409,
  constraint: 409,
  budget: 422,
};
