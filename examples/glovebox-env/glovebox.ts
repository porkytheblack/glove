/**
 * The wrap module. `glovebox build ./glovebox.ts` reads this default export
 * and emits a Dockerfile, a nixpacks.toml, the server bundle, the vendored
 * modules the bundle could not swallow, a manifest and an auth key.
 *
 * Base image: `glovebox/studio` — `glovebox/docs` plus Chromium. `env:render`
 * needs LibreOffice, `env:motion` needs a browser, and until studio existed no
 * image had both, so an agent with these two adapters could not be deployed at
 * all. See docker/studio/Dockerfile.
 */
import { composite, glovebox, rule } from "glovebox-core";

import { buildAgent } from "./agent";
import { buildEnvironment } from "./environment";
import { runSelfcheckAndExit } from "./selfcheck";

// Before anything else, because it is the reason this example exists: prove
// the image can run a script. `docker run -e GLOVEBOX_SELFCHECK=1 <image>`
// exercises the environment, both adapters and the encoder, then exits — no
// model, no API key, no client.
if (process.env.GLOVEBOX_SELFCHECK) await runSelfcheckAndExit();

const env = await buildEnvironment();

export default glovebox.wrap(buildAgent(env), {
  name: "glovebox-env",
  version: "0.1.0",
  base: "glovebox/studio",
  env: {
    ANTHROPIC_API_KEY: {
      required: true,
      secret: true,
      description: "API key for the Anthropic provider the agent runs on.",
    },
  },
  storage: {
    // Renders are PNGs and MP4s: small ones ride inline, anything real is
    // served from the box for an hour and fetched on demand.
    outputs: composite([rule.inline({ below: "512KB" }), rule.localServer({ ttl: "1h" })]),
  },
  limits: {
    memory: "2Gi",
    // A browser launch plus a screenshot per frame; the environment's own
    // script budget (environment.ts) is 4 minutes, so the box needs more.
    timeout: "10m",
  },
});
