import { createHmac, timingSafeEqual } from "node:crypto";

// Sign-in by invite link. `pnpm invite <personId>` prints a link whose token
// is `personId.expiresAt.mac`, the MAC being HMAC-SHA256 with
// WEB_SESSION_SECRET over the first two parts. Opening it sets the `session`
// cookie, the same shape with a 30-day expiry. The person's workspace is
// their id. Invite and session MACs are keyed apart, so neither works as the
// other.

const INVITE_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = "session";

// Signs dev sessions when no secret is set. Anyone can forge these, which is
// why production refuses to run without WEB_SESSION_SECRET.
const DEV_SECRET = "glove-foundry-web-kit dev only";

export interface SignOptions {
  /** Defaults to WEB_SESSION_SECRET. */
  readonly secret?: string;
  /** Epoch milliseconds; defaults to now. */
  readonly now?: number;
}

/** True in development with no WEB_SESSION_SECRET: the sign-in page may offer the demo people. */
export function devSignIn(): boolean {
  return !process.env.WEB_SESSION_SECRET && process.env.NODE_ENV !== "production";
}

function secretOf(options: SignOptions): string {
  const secret = options.secret ?? process.env.WEB_SESSION_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") throw new Error("Set WEB_SESSION_SECRET: invite links and sessions are signed with it.");
  return DEV_SECRET;
}

const PERSON_ID = /^[A-Za-z0-9_-]{1,64}$/;

function mac(purpose: "invite" | "session", payload: string, secret: string): string {
  return createHmac("sha256", secret).update(`${purpose}:${payload}`).digest("base64url");
}

function sign(purpose: "invite" | "session", personId: string, ttl: number, options: SignOptions): { readonly value: string; readonly expiresAt: number } {
  if (!PERSON_ID.test(personId)) throw new Error(`"${personId}" isn't a person id: use letters, digits, - and _.`);
  const expiresAt = (options.now ?? Date.now()) + ttl;
  const payload = `${personId}.${expiresAt}`;
  return { value: `${payload}.${mac(purpose, payload, secretOf(options))}`, expiresAt };
}

function verify(purpose: "invite" | "session", value: string | undefined | null, options: SignOptions): { readonly personId: string; readonly expiresAt: number } | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [personId, expires, given] = parts as [string, string, string];
  const expiresAt = Number(expires);
  if (!PERSON_ID.test(personId) || !/^\d+$/.test(expires)) return null;
  const expected = Buffer.from(mac(purpose, `${personId}.${expires}`, secretOf(options)));
  const actual = Buffer.from(given);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  if (expiresAt <= (options.now ?? Date.now())) return null;
  return { personId, expiresAt };
}

/** An invite token for `<WEB_URL>/signin?t=<token>`, good for 7 days. */
export function createInvite(personId: string, options: SignOptions = {}): string {
  return sign("invite", personId, INVITE_MS, options).value;
}

/** The person an invite token names, or null if it is tampered with or expired. */
export function verifyInvite(token: string | undefined | null, options: SignOptions = {}) {
  return verify("invite", token, options);
}

export interface CookieOptions {
  readonly httpOnly: true;
  readonly secure: boolean;
  readonly sameSite: "lax";
  readonly path: "/";
  readonly maxAge: number;
}

/** The `session` cookie for a person: HttpOnly, SameSite=Lax, Secure over https, 30 days. */
export function sessionCookie(personId: string, options: SignOptions & { readonly secure: boolean }): { readonly name: string; readonly value: string; readonly options: CookieOptions } {
  const { value } = sign("session", personId, SESSION_MS, options);
  return { name: SESSION_COOKIE, value, options: { httpOnly: true, secure: options.secure, sameSite: "lax", path: "/", maxAge: SESSION_MS / 1000 } };
}

/** Clears the cookie on sign-out. */
export function clearedSessionCookie(secure: boolean): { readonly name: string; readonly value: string; readonly options: CookieOptions } {
  return { name: SESSION_COOKIE, value: "", options: { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 0 } };
}

/** The person a session cookie names, or null. */
export function readSession(value: string | undefined | null, options: SignOptions = {}): { readonly personId: string } | null {
  const session = verify("session", value, options);
  return session ? { personId: session.personId } : null;
}

/** Whether the request came over https, directly or through a proxy that says so. */
export function isHttps(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return forwarded === "https" || new URL(request.url).protocol === "https:" || Boolean(process.env.WEB_URL?.startsWith("https:"));
}
