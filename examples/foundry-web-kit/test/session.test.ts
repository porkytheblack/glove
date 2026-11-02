import assert from "node:assert/strict";
import { test } from "node:test";
import { createInvite, readSession, sessionCookie, verifyInvite } from "../src/server/session";

const secret = "test-secret";
const now = Date.UTC(2026, 9, 27, 9, 0, 0);
const day = 24 * 60 * 60 * 1000;

test("an invite names its person until it expires a week later", () => {
  const token = createInvite("maya", { secret, now });
  assert.match(token, /^maya\.\d+\.[\w-]+$/);
  assert.deepEqual(verifyInvite(token, { secret, now: now + 6 * day }), { personId: "maya", expiresAt: now + 7 * day });
  assert.equal(verifyInvite(token, { secret, now: now + 7 * day }), null, "expired");
});

test("a tampered invite is rejected", () => {
  const token = createInvite("maya", { secret, now });
  const [, expires, mac] = token.split(".");
  assert.equal(verifyInvite(`sam.${expires}.${mac}`, { secret, now }), null, "another person");
  assert.equal(verifyInvite(`maya.${Number(expires) + day}.${mac}`, { secret, now }), null, "a later expiry");
  assert.equal(verifyInvite(`${token.slice(0, -2)}xx`, { secret, now }), null, "a changed MAC");
  assert.equal(verifyInvite(token, { secret: "another-secret", now }), null, "another secret");
  assert.equal(verifyInvite("maya.not-a-time.x", { secret, now }), null);
  assert.equal(verifyInvite("", { secret, now }), null);
});

test("a session round-trips through its cookie for 30 days", () => {
  const cookie = sessionCookie("maya", { secret, now, secure: true });
  assert.equal(cookie.name, "session");
  assert.deepEqual(cookie.options, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 30 * 24 * 60 * 60 });
  assert.deepEqual(readSession(cookie.value, { secret, now: now + 29 * day }), { personId: "maya" });
  assert.equal(readSession(cookie.value, { secret, now: now + 30 * day }), null, "expired");
});

test("an invite token is not a session, and a session is not an invite", () => {
  const invite = createInvite("maya", { secret, now });
  const session = sessionCookie("maya", { secret, now, secure: false }).value;
  assert.equal(readSession(invite, { secret, now }), null);
  assert.equal(verifyInvite(session, { secret, now }), null);
});

test("person ids that would break the token are refused", () => {
  assert.throws(() => createInvite("maya.admin", { secret, now }));
  assert.throws(() => createInvite("", { secret, now }));
});

test("production needs WEB_SESSION_SECRET", () => {
  const saved = { secret: process.env.WEB_SESSION_SECRET, env: process.env.NODE_ENV };
  delete process.env.WEB_SESSION_SECRET;
  (process.env as Record<string, string>).NODE_ENV = "production";
  try {
    assert.throws(() => createInvite("maya"), /WEB_SESSION_SECRET/);
  } finally {
    if (saved.secret !== undefined) process.env.WEB_SESSION_SECRET = saved.secret;
    (process.env as Record<string, string | undefined>).NODE_ENV = saved.env;
  }
});
