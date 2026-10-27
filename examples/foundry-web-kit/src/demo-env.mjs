import { createHmac } from "node:crypto";

// Demo connectors (DEMO_CONNECTORS=1): mock providers served by the web app
// in its own unit, so inbound and outbound can be shown without real
// accounts. A mock signs the webhooks it sends with the same secret the
// app's webhook route checks, and the app's sends go to the mock's API
// instead of the provider's. The start scripts call withDemoEnv before they
// start Foundry and the web app, so both processes get the same values.
// Plain JavaScript, because the start scripts run before anything compiles
// TypeScript.

/**
 * A secret for one mock, derived from WEB_SESSION_SECRET: the route that
 * checks it and the mock that signs with it agree without another stored
 * secret.
 */
export function demoSecret(name, base = process.env.WEB_SESSION_SECRET) {
  return createHmac("sha256", base ?? "glove-foundry-web-kit dev only").update(`demo-connectors:${name}`).digest("hex");
}

/**
 * With DEMO_CONNECTORS=1, `env` plus what `vars(secret, web)` returns: the
 * mocks' secrets and the base URLs of their APIs. `web` is the web app on
 * loopback, which serves those APIs. The mocks replace the providers, so
 * these win over anything already set. Without DEMO_CONNECTORS=1, `env` as
 * it is.
 */
export function withDemoEnv(env, vars) {
  if (env.DEMO_CONNECTORS !== "1") return env;
  const web = `http://127.0.0.1:${env.PORT ?? "3000"}`;
  return { ...env, ...vars((name) => demoSecret(name, env.WEB_SESSION_SECRET), web) };
}
