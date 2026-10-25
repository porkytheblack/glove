import type { Tokens } from "./accounts.js";

// OAuth for the providers the apps connect to. Foundry takes no part: your
// app runs the flow, stores the tokens, and refreshes them inside
// accountSessions. scripts/connect.ts runs this flow from a terminal; in a web
// app the same calls sit behind /connect/:app and /connect/:app/callback.

export type Provider = "google" | "linear";

const PROVIDERS = {
  google: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    // A refresh token, so the bots keep working after the hour is up.
    extra: { access_type: "offline", prompt: "consent" },
    client: () => ({ id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET }),
  },
  linear: {
    authorizeUrl: "https://linear.app/oauth/authorize",
    tokenUrl: "https://api.linear.app/oauth/token",
    extra: {},
    client: () => ({ id: process.env.LINEAR_CLIENT_ID, secret: process.env.LINEAR_CLIENT_SECRET }),
  },
} as const;

/** Whether this deployment has an OAuth client for the provider. Without one, apps run offline. */
export function configured(provider: Provider): boolean {
  return Boolean(PROVIDERS[provider].client().id);
}

function client(provider: Provider) {
  const { id, secret } = PROVIDERS[provider].client();
  if (!id || !secret) throw new Error(`Set ${provider.toUpperCase()}_CLIENT_ID and ${provider.toUpperCase()}_CLIENT_SECRET.`);
  return { id, secret };
}

/** `scope` is what the app needs, in the provider's format (see SCOPES in connect.ts). */
export function authorizeUrl(provider: Provider, options: { readonly scope: string; readonly redirectUri: string; readonly state: string; readonly codeChallenge: string }): string {
  const config = PROVIDERS[provider];
  const url = new URL(config.authorizeUrl);
  url.search = new URLSearchParams({
    client_id: client(provider).id,
    redirect_uri: options.redirectUri,
    response_type: "code",
    scope: options.scope,
    state: options.state,
    code_challenge: options.codeChallenge,
    code_challenge_method: "S256",
    ...config.extra,
  }).toString();
  return url.toString();
}

async function token(provider: Provider, body: Record<string, string>): Promise<Tokens> {
  const { id, secret } = client(provider);
  const response = await fetch(PROVIDERS[provider].tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...body, client_id: id, client_secret: secret }),
  });
  if (!response.ok) throw new Error(`${provider} token endpoint: ${response.status} ${await response.text()}`);
  const json = await response.json() as { access_token: string; refresh_token?: string; expires_in?: number };
  return {
    accessToken: json.access_token,
    ...(json.refresh_token ? { refreshToken: json.refresh_token } : {}),
    ...(json.expires_in ? { expiresAt: Date.now() + json.expires_in * 1000 } : {}),
  };
}

export function exchange(provider: Provider, options: { readonly code: string; readonly redirectUri: string; readonly codeVerifier: string }): Promise<Tokens> {
  return token(provider, {
    grant_type: "authorization_code",
    code: options.code,
    redirect_uri: options.redirectUri,
    code_verifier: options.codeVerifier,
  });
}

/** Called from accountSessions when a token is about to expire. Keeps the old refresh token if none comes back. */
export async function refresh(provider: Provider, refreshToken: string): Promise<Tokens> {
  const fresh = await token(provider, { grant_type: "refresh_token", refresh_token: refreshToken });
  return { ...fresh, refreshToken: fresh.refreshToken ?? refreshToken };
}

/** Who the tokens belong to, for the account record. */
export async function identify(provider: Provider, accessToken: string): Promise<{
  readonly externalAccountId: string;
  readonly label: string;
  readonly metadata: Record<string, string>;
}> {
  const authorization = `Bearer ${accessToken}`;
  if (provider === "google") {
    // Every Google app asks for `openid email`, so one lookup names the account.
    const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization } });
    if (!response.ok) throw new Error(`Google userinfo: ${response.status}`);
    const { email } = await response.json() as { email: string };
    return { externalAccountId: email, label: email, metadata: { email } };
  }
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ query: "{ viewer { id name email } }" }),
  });
  if (!response.ok) throw new Error(`Linear viewer: ${response.status}`);
  const { data } = await response.json() as { data: { viewer: { id: string; name: string; email: string } } };
  return { externalAccountId: data.viewer.id, label: `${data.viewer.name} on Linear`, metadata: { email: data.viewer.email } };
}
