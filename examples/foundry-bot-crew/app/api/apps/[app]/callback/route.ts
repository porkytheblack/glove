import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { currentPerson } from "glove-foundry-web-kit/server";
import { host, writes } from "../../../../server/host";
import { seeOther } from "../../../../server/http";
import { OAUTH_COOKIE, callbackUrl } from "../../../../server/oauth";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * The provider sends the person back here. With a matching state, the code
 * becomes tokens; connectApp saves the account in the store (tokens stay
 * there) and gives the app to every one of the person's bots.
 */
export async function GET(request: Request, { params }: { params: Promise<{ app: string }> }) {
  const back = (query: string) => {
    const response = seeOther(`/apps?${query}`);
    response.cookies.set(OAUTH_COOKIE, "", { path: "/api/apps", maxAge: 0 });
    return response;
  };
  const person = await currentPerson();
  if (!person) return seeOther("/welcome");
  const url = new URL(request.url);
  const [app, personId, state, verifier] = ((await cookies()).get(OAUTH_COOKIE)?.value ?? "").split(".");
  const code = url.searchParams.get("code");
  if (!app || app !== (await params).app || personId !== person.id || !state || !verifier || !code || !same(state, url.searchParams.get("state") ?? "")) {
    return back("error=sign-in");
  }
  const { connect, oauth } = await host();
  const name = connect.APP_NAMES.find((item) => item === app);
  if (!name) return back("error=sign-in");
  try {
    const provider = connect.PROVIDERS[name];
    const tokens = await oauth.exchange(provider, { code, redirectUri: callbackUrl(request, name), codeVerifier: verifier });
    const identity = await oauth.identify(provider, tokens.accessToken);
    await connect.connectApp(await writes(), person, name, { tokens, identity });
  } catch (error) {
    console.error(error);
    return back("error=sign-in");
  }
  return back(`connected=${name}`);
}
