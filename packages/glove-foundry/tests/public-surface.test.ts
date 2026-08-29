import assert from "node:assert/strict";
import { test } from "node:test";
import * as foundry from "../src/index.js";

test("Foundry's public API does not expose execution-backend primitives", () => {
  for (const name of [
    "defineBeacon",
    "compileStationPlan",
    "StationDeployment",
    "CompiledStationPlan",
    "reconstructSchedule",
    "definePlaybook",
    "FOUNDRY_PLAYBOOK_BRAND",
  ]) {
    assert.equal(name in foundry, false, `${name} leaked into the public API`);
  }
  assert.equal("defineSchedule" in foundry, true);
  assert.equal("composePlaybook" in foundry, true);
});
