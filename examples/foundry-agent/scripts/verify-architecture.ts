import assert from "node:assert/strict";
import { Effect } from "effect";
import {
  compileApplicationManifest,
  discoverAgents,
} from "glove-foundry";
import application from "../foundry.application.js";
import releaseNotes from "../agents/release-planner/apps/release-notes.app.js";
import { supportInbound } from "../agents/release-planner/topology.js";
import supportTransmission from "../agents/release-planner/transmissions/support.transmission.js";

await discoverAgents({ agentsDir: new URL("../agents", import.meta.url).pathname });

const manifest = await Effect.runPromise(
  compileApplicationManifest([supportTransmission]),
);

assert.equal(manifest.schemaVersion, 2);
assert.equal(manifest.transmissions[0]?.shape, "bidirectional");
assert.equal(releaseNotes.connections?.[0]?.transmissions[0], supportTransmission);
assert.equal(application.routes?.[0], supportInbound);

const compiled = JSON.stringify({ manifest, routes: application.routes });
const openRouterKey = process.env.OPENROUTER_API_KEY;
if (openRouterKey) assert.equal(compiled.includes(openRouterKey), false);
assert.equal(compiled.includes("accessToken"), false);
assert.equal(compiled.includes("refreshToken"), false);

process.stdout.write("Effect architecture verification passed.\n");
process.stdout.write(
  `Compiled ${manifest.transmissions.length} transmission with typed application connections.\n`,
);
