// DEV ONLY: hands the raw GEMINI_API_KEY to the browser, which is fine on
// localhost and NOT fine in production. For production, mint an ephemeral
// token via the Gemini Live auth_tokens API and return that instead — the
// adapter's getToken callback doesn't care which it receives.
export async function GET() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return Response.json({ error: "GEMINI_API_KEY is not set" }, { status: 500 });
  }
  return Response.json({ token: key });
}
