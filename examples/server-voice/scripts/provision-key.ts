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
// WHAT THE KEY CAN AND CANNOT DO — worth being precise about, because it is not
// obvious from the outside:
//
//   ✓ /api/v1/*  — signals, runs, events, health, expressions, env, schedules,
//                  gated by scope (read / trigger / cancel / admin).
//   ✗ /api/*     — the dashboard API, which is where BEACON start/stop lives.
//                  That surface accepts only a session cookie, so an API key
//                  cannot start or stop a room. The web app therefore logs in
//                  with the username/password for room control (see
//                  web/app/lib/station.ts) and uses this key for v1 reads.
//
// The key is shown ONCE. Station stores only a hash.

const STATION_URL = process.env.STATION_URL ?? "http://localhost:4400";
const USERNAME = process.env.STATION_USERNAME;
const PASSWORD = process.env.STATION_PASSWORD;

const name = process.argv[2] ?? "server-voice web app";
const scopes = process.argv.slice(3);

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

  It covers /api/v1 (runs, signals, health). Room start/stop is NOT on that
  surface — the app uses STATION_USERNAME / STATION_PASSWORD for those.
`);

export {};
