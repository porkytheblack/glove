import { timingSafeEqual } from "node:crypto";
import { Effect } from "effect";
import type { FoundryRequestAuthorizationAdapter } from "glove-foundry";

// Who may call the API and open the inspector once it is public (on Kuiper).
// API clients send `Bearer $FOUNDRY_TOKEN`; browsers log in with
// FOUNDRY_DASHBOARD_USERNAME / FOUNDRY_DASHBOARD_PASSWORD. With neither set
// there is no adapter, and Foundry stays on loopback.

const token = process.env.FOUNDRY_TOKEN;
const user = process.env.FOUNDRY_DASHBOARD_USERNAME ?? "admin";
const password = process.env.FOUNDRY_DASHBOARD_PASSWORD;

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

function allowed(authorization?: string): boolean {
  if (!authorization) return false;
  if (token && authorization.startsWith("Bearer ")) return same(authorization.slice(7), token);
  if (password && authorization.startsWith("Basic ")) {
    const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
    const i = decoded.indexOf(":");
    return i > 0 && same(decoded.slice(0, i), user) && same(decoded.slice(i + 1), password);
  }
  return false;
}

export const requestAuthorization: FoundryRequestAuthorizationAdapter | undefined = token || password
  ? {
      identifier: "kuiper",
      challenge: 'Basic realm="Foundry", charset="UTF-8"',
      authorize: ({ path, authorization }) => Effect.succeed(path === "/health" || allowed(authorization)),
    }
  : undefined;
