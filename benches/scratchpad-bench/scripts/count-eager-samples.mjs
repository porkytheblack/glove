#!/usr/bin/env node
/** How many live reads did the OLD eager `sampleResultShapes` fire at mount for
 *  the 367-tool noise catalog? = read-only fns with no required args. Lazy
 *  sampling removes all of these from mount (they warm only if described). */
import { buildMockOrg } from "../src/mcp/index.ts";
import { fnsFromMcp } from "glove-scratchpad/fns/mcp";

const org = await buildMockOrg({ seed: 1337, scale: 1, distractors: 30 });
const perServer = await Promise.all(org.connections.map((c) => fnsFromMcp(c)));
const fns = perServer.flat();

const hasNoRequired = (fn) => {
  const req = fn.inputSchema?.required;
  return !Array.isArray(req) || req.length === 0;
};
const readOnly = fns.filter((f) => f.readOnlyHint === true);
const eager = readOnly.filter(hasNoRequired);

console.log(`servers: ${org.connections.length}`);
console.log(`total functions (tools): ${fns.length}`);
console.log(`read-only functions: ${readOnly.length}`);
console.log(`EAGER-SAMPLED at mount (read-only + no required args): ${eager.length}`);
console.log(`  → lazy sampling fires 0 of these at mount; each warms only if describe()d`);
await org.close?.();
