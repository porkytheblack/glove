import { Effect } from "effect";
import type { FoundryAccountSessionAdapter } from "glove-foundry";

export type HermesMessengerProvider = "local" | "telegram";

export interface HermesMessengerSession {
  readonly provider: HermesMessengerProvider;
  readonly apiBaseUrl: string;
  readonly token?: string;
}

export function hermesMessengerProvider(): HermesMessengerProvider {
  const configured = process.env.HERMES_MESSENGER_PROVIDER?.trim().toLowerCase();
  if (configured && configured !== "local" && configured !== "telegram") {
    throw new Error(`Unsupported HERMES_MESSENGER_PROVIDER "${configured}".`);
  }
  if (configured) return configured as HermesMessengerProvider;
  return process.env.TELEGRAM_BOT_TOKEN ? "telegram" : "local";
}

/**
 * Consumer-owned credential boundary. The reference host resolves an opaque
 * account id from environment variables; Foundry never persists or returns the
 * resulting token. Replace this adapter when credentials live in a vault or
 * require refresh.
 */
export function createHermesAccountSessions(
  operator: { readonly id: string },
): FoundryAccountSessionAdapter {
  return {
    identifier: "hermes-environment-account-sessions",
    withSession(request, use) {
      if (request.accountId !== operator.id) {
        return Effect.fail(new Error(`Unknown Hermes account "${request.accountId}".`));
      }
      const provider = hermesMessengerProvider();
      if (provider === "telegram") {
        const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
        if (!token) {
          return Effect.fail(new Error("TELEGRAM_BOT_TOKEN is required for the Telegram messenger adapter."));
        }
        return use(Object.freeze({
          provider,
          token,
          apiBaseUrl: process.env.TELEGRAM_API_BASE_URL?.trim() || "https://api.telegram.org",
        } satisfies HermesMessengerSession));
      }
      return use(Object.freeze({
        provider,
        apiBaseUrl: "local://messenger",
      } satisfies HermesMessengerSession));
    },
  };
}
