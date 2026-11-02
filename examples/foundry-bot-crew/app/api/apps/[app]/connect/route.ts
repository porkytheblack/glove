import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { currentPerson, isHttps } from "glove-foundry-web-kit/server";
import { host } from "../../../../server/host";
import { seeOther } from "../../../../server/http";
import { OAUTH_COOKIE, callbackUrl } from "../../../../server/oauth";

/** Start connecting an app: off to the provider's sign-in. */
export async function GET(request: Request, { params }: { params: Promise<{ app: string }> }) {
  const person = await currentPerson();
  if (!person) return seeOther("/welcome");
  const { connect, oauth } = await host();
  const requested = (await params).app;
  const app = connect.APP_NAMES.find((name) => name === requested);
  if (!app) return seeOther("/apps");
  const provider = connect.PROVIDERS[app];
  if (!oauth.configured(provider)) return seeOther("/apps?error=not-set-up");

  const state = randomBytes(16).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const response = NextResponse.redirect(oauth.authorizeUrl(provider, {
    scope: connect.SCOPES[app],
    redirectUri: callbackUrl(request, app),
    state,
    codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
  }), 303);
  response.cookies.set(OAUTH_COOKIE, `${app}.${person.id}.${state}.${verifier}`, {
    httpOnly: true,
    secure: isHttps(request),
    sameSite: "lax",
    path: "/api/apps",
    maxAge: 600,
  });
  return response;
}
