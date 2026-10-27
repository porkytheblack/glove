import { NextResponse } from "next/server";
import { devSignIn, isHttps, sessionCookie, verifyInvite } from "glove-foundry-web-kit/server";
import { host } from "../server/host";
import { seeOther } from "../server/http";

// /signin?t=<token> is the invite link `pnpm invite <personId>` prints. A
// valid token sets the session cookie and opens the app; anything else goes
// to the sign-in page. In development with no WEB_SESSION_SECRET, the page
// posts a demo person's id here instead.

function signedIn(request: Request, personId: string): NextResponse {
  const response = seeOther("/bots");
  const cookie = sessionCookie(personId, { secure: isHttps(request) });
  response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}

export async function GET(request: Request) {
  const invite = verifyInvite(new URL(request.url).searchParams.get("t"));
  if (!invite) return seeOther("/welcome?link=expired");
  return signedIn(request, invite.personId);
}

export async function POST(request: Request) {
  const personId = String((await request.formData()).get("person") ?? "");
  const demo = (await host()).people.MAYA;
  if (!devSignIn() || personId !== demo.id) return seeOther("/welcome");
  return signedIn(request, personId);
}
