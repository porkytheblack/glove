import "server-only";

// Authenticated access to station, from the Next.js server only.
//
// Station's API can start and stop processes on the host, so it is gated. Two
// credential types exist and they do NOT cover the same routes — worth knowing
// before wiring anything:
//
//   • `/api/*`     — the dashboard API, which is where beacon start/stop lives.
//                    Accepts ONLY a `station_session` cookie, obtained by
//                    POSTing username/password to /api/auth/login.
//   • `/api/v1/*`  — the programmatic API. Accepts a session cookie OR an
//                    `Authorization: Bearer sk_live_…` API key, with scopes
//                    (read / trigger / cancel / admin). It has no beacon
//                    routes.
//
// So room control necessarily goes through the session, and the API key covers
// the v1 surface (runs, signals, health) for anything else this app wants to
// read. Both live in this module, server-side, and neither ever reaches the
// browser — the client only ever sees a WebSocket URL.

const STATION_URL = process.env.STATION_URL ?? "http://localhost:4400";
const USERNAME = process.env.STATION_USERNAME;
const PASSWORD = process.env.STATION_PASSWORD;
const API_KEY = process.env.STATION_API_KEY;

/** Cached session cookie. Re-minted on demand and whenever station 401s. */
let sessionCookie: string | null = null;
let loginInFlight: Promise<string> | null = null;

class StationAuthError extends Error {}

async function login(): Promise<string> {
  if (!USERNAME || !PASSWORD) {
    throw new StationAuthError(
      "STATION_USERNAME / STATION_PASSWORD are not set in the web app's environment — it cannot authenticate to station.",
    );
  }
  const res = await fetch(`${STATION_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new StationAuthError(
      res.status === 401
        ? "station rejected the credentials — check STATION_USERNAME / STATION_PASSWORD match the ones station was started with."
        : `station login failed (${res.status})`,
    );
  }
  const setCookie = res.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/station_session=([^;]+)/);
  if (!match) throw new StationAuthError("station login returned no session cookie");
  sessionCookie = `station_session=${match[1]}`;
  return sessionCookie;
}

/** Serialize concurrent logins so a burst of requests mints one session. */
function ensureSession(): Promise<string> {
  if (sessionCookie) return Promise.resolve(sessionCookie);
  loginInFlight ??= login().finally(() => {
    loginInFlight = null;
  });
  return loginInFlight;
}

/**
 * Call the dashboard API (`/api/…`) with a session, re-authenticating once if
 * the cached cookie has expired.
 */
export async function stationFetch(path: string, init?: RequestInit): Promise<Response> {
  const call = async (cookie: string) =>
    fetch(`${STATION_URL}/api${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", cookie, ...(init?.headers ?? {}) },
      cache: "no-store",
    });

  let res = await call(await ensureSession());
  if (res.status === 401) {
    sessionCookie = null;
    res = await call(await ensureSession());
  }
  return res;
}

/**
 * Call the programmatic API (`/api/v1/…`) with the API key when one is
 * provisioned, falling back to the session. Use this for reads — runs,
 * signals, health — not for room control, which v1 does not expose.
 */
export async function stationV1Fetch(path: string, init?: RequestInit): Promise<Response> {
  if (API_KEY) {
    return fetch(`${STATION_URL}/api/v1${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        authorization: `Bearer ${API_KEY}`,
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
  }
  return stationFetch(`/v1${path}`, init);
}

export { StationAuthError, STATION_URL };
