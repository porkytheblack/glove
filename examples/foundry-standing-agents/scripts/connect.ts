import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createFoundryClient, discoverAgents } from "glove-foundry";
import { APP_NAMES, PROVIDERS, SCOPES, connectApp, writesVia, type AppName } from "../lib/connect.js";
import { authorizeUrl, exchange, identify } from "../lib/oauth.js";

// Connect one of a person's apps from a terminal: the provider's sign-in in
// your browser, then the mailbox goes to their dot. A web app
// runs the same steps behind /connect/:app and /connect/:app/callback.
//   pnpm connect sam gmail
// Register http://127.0.0.1:53683/callback as a redirect URI on your OAuth client.

const [person = "", app = "" as AppName] = process.argv.slice(2) as [string, AppName];
if (!person || !APP_NAMES.includes(app)) throw new Error(`Usage: pnpm connect <person> <${APP_NAMES.join("|")}>`);
const provider = PROVIDERS[app];
const redirectUri = "http://127.0.0.1:53683/callback";
const state = randomBytes(16).toString("base64url");
const codeVerifier = randomBytes(32).toString("base64url");
const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

const code = await new Promise<string>((resolve, reject) => {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", redirectUri);
    if (url.pathname !== "/callback") return void response.writeHead(404).end();
    const returned = url.searchParams.get("code");
    response.writeHead(200, { "content-type": "text/plain" }).end(returned ? "Connected. You can close this tab." : "Sign-in failed.");
    server.close();
    if (url.searchParams.get("state") !== state || !returned) reject(new Error(url.searchParams.get("error") ?? "The sign-in did not return a code."));
    else resolve(returned);
  }).listen(53683, "127.0.0.1");
  console.log(`Open this to connect ${app} for ${person}:\n${authorizeUrl(provider, { scope: SCOPES[app], redirectUri, state, codeChallenge })}`);
});

const tokens = await exchange(provider, { code, redirectUri, codeVerifier });
const identity = await identify(provider, tokens.accessToken);
await discoverAgents({ agentsDir: fileURLToPath(new URL("../agents", import.meta.url)) });
const foundry = createFoundryClient({
  baseUrl: process.env.FOUNDRY_URL ?? "http://127.0.0.1:4145",
  ...(process.env.FOUNDRY_TOKEN ? { authorization: { identifier: "connect", headers: () => ({ authorization: `Bearer ${process.env.FOUNDRY_TOKEN}` }) } } : {}),
});
const account = await connectApp(writesVia.client(foundry), { id: person }, app, { tokens, identity });
console.log(`Connected ${account.label} for ${person}. Their dot has ${app} from the next message.`);
