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

test("includeTools accepts exact names and glob patterns", () => {
  const kept = catalog.filter((t) =>
    includeTool(t, { includeTools: ["list_*", "create_issu?"] }),
  );
  assert.deepEqual(kept.map((t) => t.name), ["list_pull_requests", "create_issue"]);
});

test("an explicit includeTools allowlist takes precedence over a broad exclusion", () => {
  const kept = catalog.filter((t) =>
    includeTool(t, { includeTools: ["*_issue", "delete_repository"], excludeTools: ["delete_*"] }),
  );
  assert.deepEqual(kept.map((t) => t.name), ["create_issue", "delete_repository"]);
});

test("glob character classes are supported and malformed classes stay literal", () => {
  assert.equal(includeTool(tool("read_1"), { includeTools: ["read_[0-9]"] }), true);
  assert.equal(includeTool(tool("read_a"), { includeTools: ["read_[!0-9]"] }), true);
  assert.equal(includeTool(tool("read_1"), { includeTools: ["read_[!0-9]"] }), false);
  assert.equal(includeTool(tool("read_["), { includeTools: ["read_["] }), true);
});

test("filterTools drops by predicate (e.g. destructive) on top of excludeTools", () => {
  const kept = catalog.filter((t) =>
    includeTool(t, { filterTools: (x) => !x.annotations?.destructiveHint }),
  );
  assert.deepEqual(kept.map((t) => t.name), ["list_pull_requests", "create_issue"]);
});

test("excludeTools and filterTools compose when there is no explicit allowlist", () => {
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
