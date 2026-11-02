import { clearedSessionCookie, isHttps } from "glove-foundry-web-kit/server";
import { seeOther } from "../server/http";

export async function POST(request: Request) {
  const response = seeOther("/welcome");
  const cookie = clearedSessionCookie(isHttps(request));
  response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}
