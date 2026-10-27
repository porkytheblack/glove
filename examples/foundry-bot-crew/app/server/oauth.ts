import "server-only";

// Connecting an app from the web: the same steps as `pnpm connect`, behind
// /api/apps/<app>/connect and its callback. The state and PKCE verifier wait
// in an HttpOnly cookie for the provider to send the person back.

import { origin } from "./http";

export const OAUTH_COOKIE = "crew_connect";

export const callbackUrl = (request: Request, app: string) => `${origin(request)}/api/apps/${app}/callback`;
