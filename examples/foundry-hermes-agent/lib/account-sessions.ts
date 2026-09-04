import type { FoundryAccountSessionAdapter } from "glove-foundry";

/**
 * Demo-only account selection. A production adapter would resolve a session
 * from the opaque account id; Foundry never sees acquisition or refresh logic.
 */
export const hermesAccountSessions: FoundryAccountSessionAdapter = {
  identifier: "hermes-example-account-sessions",
  withSession(request, use) {
    return use(Object.freeze({
      accountId: request.accountId,
      operation: request.operation,
      transport: "local-fixture",
    }));
  },
};
