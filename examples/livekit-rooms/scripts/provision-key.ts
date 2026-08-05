// Provision a station API key.
//
//   pnpm key                     # read + trigger (default)
//   pnpm key "ci runner" read    # named, with explicit scopes
//
// Station must be running, and STATION_USERNAME / STATION_PASSWORD must match
// what it was started with — creating a key is an admin action, so this logs in
// first and mints the key through station's own API. Doing it that way (rather
// than writing the key file directly) means station applies its own hashing and
// server-side pepper, so the key verifies.
//
// The web app drives the whole room lifecycle with this key and nothing else:
//
//   start    POST /api/v1/trigger            scope: trigger
//   ready    GET  /api/v1/runs/:id           scope: read
//   hang up  POST /api/v1/runs/:id/cancel    scope: cancel
//
// So mint it with all three:  pnpm key "web app" trigger read cancel
//
// (Keys authenticate /api/v1 only. The dashboard API /api/* takes a session
// cookie — which is exactly why rooms are signals rather than beacons: beacon
// control lives only on that surface. See signals/room.ts.)
//
// The key is shown ONCE. Station stores only a hash.

import "../lib/load-env";

const STATION_URL = process.env.STATION_URL ?? "http://localhost:4430";
const USERNAME = process.env.STATION_USERNAME;
const PASSWORD = process.env.STATION_PASSWORD;

const name = process.argv[2] ?? "livekit-rooms web app";
// Everything the web app needs, unless the caller asks for something narrower.
const scopes = process.argv.length > 3 ? process.argv.slice(3) : ["trigger", "read", "cancel"];

if (!USERNAME || !PASSWORD) {
  console.error(
    "STATION_USERNAME and STATION_PASSWORD must be set (the same values station was started with).",
  );
  process.exit(1);
}

const login = await fetch(`${STATION_URL}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
});

if (!login.ok) {
  console.error(
    login.status === 401
      ? `station rejected those credentials (401). They must match the STATION_USERNAME / STATION_PASSWORD station itself was started with.`
      : `station login failed (${login.status}). Is it running at ${STATION_URL}?`,
  );
  process.exit(1);
}

const cookie = (login.headers.get("set-cookie") ?? "").match(/station_session=([^;]+)/);
if (!cookie) {
  console.error("station login returned no session cookie.");
  process.exit(1);
}

const res = await fetch(`${STATION_URL}/api/v1/keys`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    cookie: `station_session=${cookie[1]}`,
  },
  body: JSON.stringify({ name, ...(scopes.length ? { scopes } : {}) }),
});

if (!res.ok) {
  console.error(`could not create the key (${res.status}): ${await res.text()}`);
  process.exit(1);
}

const { data } = (await res.json()) as {
  data: { key: string; name: string; scopes: string[]; keyPrefix: string };
};

console.log(`
  Key created — this is the only time it is shown.

    name    ${data.name}
    scopes  ${data.scopes.join(", ")}
    key     ${data.key}

  Add it to the web app's environment:

    STATION_API_KEY=${data.key}

  That is the only credential the web app needs — it starts rooms, polls them,
  and hangs up entirely through station's v1 API.
`);

export {};
