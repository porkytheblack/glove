import "server-only";

// Authenticated access to station, from the Next.js server only.
//
// ONE credential: a station API key, `Authorization: Bearer sk_live_…`. No
// login, no session cookie, no password in this app at all.
//
// That is possible because a room is a signal run rather than a beacon, so its
// whole lifecycle sits on station's v1 API — the surface API keys authenticate:
//
//   start    POST /api/v1/trigger            scope: trigger
//   ready    GET  /api/v1/runs/:id           scope: read
//   hang up  POST /api/v1/runs/:id/cancel    scope: cancel
//
// (Beacon control lives only on the dashboard API, which takes a session
// cookie — there are no beacon routes under v1. That constraint is why rooms
// are signals; see signals/room.ts.)
//
// Mint a key with `pnpm key`. It never reaches the browser: the client is
// handed a WebSocket URL and nothing else.

const STATION_URL = process.env.STATION_URL ?? "http://localhost:4430";
const API_KEY = process.env.STATION_API_KEY;

export class StationAuthError extends Error {}

/** Call station's v1 API with the key. */
export async function stationV1(path: string, init?: RequestInit): Promise<Response> {
  if (!API_KEY) {
    throw new StationAuthError(
      "STATION_API_KEY is not set. Start station, then run `pnpm key` in examples/livekit-rooms and put the key in the web app's environment.",
    );
  }
  const res = await fetch(`${STATION_URL}/api/v1${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      authorization: `Bearer ${API_KEY}`,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (res.status === 401) {
    throw new StationAuthError(
      "station rejected the API key (401). It may have been revoked, or minted against a different station data directory — re-run `pnpm key`.",
    );
  }
  if (res.status === 403) {
    throw new StationAuthError(
      "the API key is missing a scope (403). Rooms need `trigger`, `read` and `cancel` — re-mint with: pnpm key \"web app\" trigger read cancel",
    );
  }
  return res;
}

export { STATION_URL };
