import { test } from "node:test";
import assert from "node:assert/strict";
import type { McpCatalogueEntry } from "../src/adapter";
import { matchEntries } from "../src/discovery/match";

const catalogue: McpCatalogueEntry[] = [
  { id: "crm", name: "CRM", description: "Customer accounts: tier, ARR, region, renewal.", url: "x", tags: ["accounts", "customers", "revenue", "arr"] },
  { id: "analytics", name: "Product Analytics", description: "Per-account product usage: MAU/WAU and 30-day usage trend.", url: "x", tags: ["analytics", "usage", "mau"] },
  { id: "issues", name: "Issue Tracker", description: "Engineering issues and bugs per account.", url: "x", tags: ["issues", "bugs"] },
  { id: "hr", name: "HR Directory", description: "Internal employee directory.", url: "x", tags: ["hr", "employees"] },
];
const ids = (es: McpCatalogueEntry[]) => es.map((e) => e.id);

test("multi-word query matches by word overlap (the regression)", () => {
  // "customer accounts CRM" is NOT a contiguous substring of any haystack —
  // whole-string includes() would return nothing. Word overlap finds CRM.
  const r = matchEntries(catalogue, "customer accounts CRM", undefined);
  assert.equal(r[0]?.id, "crm", "CRM should rank first for 'customer accounts CRM'");
});

test("'product-usage analytics' finds the analytics provider", () => {
  const r = matchEntries(catalogue, "product-usage analytics", undefined);
  assert.equal(r[0]?.id, "analytics");
});

test("single-word query still works", () => {
  assert.equal(matchEntries(catalogue, "issues", undefined)[0]?.id, "issues");
});

test("tag filter only (no query) lists the tagged entries", () => {
  assert.deepEqual(ids(matchEntries(catalogue, undefined, ["usage"])), ["analytics"]);
});

test("empty query lists everything (capped at 10)", () => {
  assert.equal(matchEntries(catalogue, "", undefined).length, catalogue.length);
});

test("a query with no overlapping words returns nothing", () => {
  assert.equal(matchEntries(catalogue, "zzz nonexistent", undefined).length, 0);
});
