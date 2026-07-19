import { test } from "node:test";
import assert from "node:assert/strict";
import { includeTool } from "../src/index";
import type { McpToolDef } from "../src/connect";

function tool(name: string, extra: Partial<McpToolDef> = {}): McpToolDef {
  return { name, inputSchema: { type: "object" }, ...extra };
}

const catalog: McpToolDef[] = [
  tool("list_pull_requests", { annotations: { readOnlyHint: true } }),
  tool("create_issue"),
  tool("delete_repository", { annotations: { destructiveHint: true } }),
];

test("excludeTools drops tools by exact un-namespaced name", () => {
  const kept = catalog.filter((t) => includeTool(t, { excludeTools: ["delete_repository"] }));
  assert.deepEqual(kept.map((t) => t.name), ["list_pull_requests", "create_issue"]);
});

test("excludeTools accepts a Set and drops several", () => {
  const kept = catalog.filter((t) =>
    includeTool(t, { excludeTools: new Set(["delete_repository", "create_issue"]) }),
  );
  assert.deepEqual(kept.map((t) => t.name), ["list_pull_requests"]);
});

test("filterTools drops by predicate (e.g. destructive) on top of excludeTools", () => {
  const kept = catalog.filter((t) =>
    includeTool(t, { filterTools: (x) => !x.annotations?.destructiveHint }),
  );
  assert.deepEqual(kept.map((t) => t.name), ["list_pull_requests", "create_issue"]);
});

test("excludeTools and filterTools compose (a name in excludeTools is dropped regardless)", () => {
  const kept = catalog.filter((t) =>
    includeTool(t, {
      excludeTools: ["create_issue"],
      filterTools: (x) => !x.annotations?.destructiveHint,
    }),
  );
  assert.deepEqual(kept.map((t) => t.name), ["list_pull_requests"]);
});

test("no rules keeps everything", () => {
  const kept = catalog.filter((t) => includeTool(t, {}));
  assert.equal(kept.length, 3);
});
