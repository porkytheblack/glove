import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeMcpMetadata, sanitizeMcpText, sanitizeMcpValue } from "../src/index";

test("sanitizeMcpText strips invisible Unicode TAG characters", () => {
  assert.equal(sanitizeMcpText(`safe\u{E0061}\u{E0062} text`), "safe text");
});

test("sanitizeMcpText preserves complete emoji tag flags", () => {
  const flag = `\u{1F3F4}\u{E0067}\u{E0062}\u{E007F}`;
  assert.equal(sanitizeMcpText(`before ${flag} after`), `before ${flag} after`);
});

test("sanitizeMcpValue recursively sanitizes keys and values without mutation", () => {
  const input = { [`nam\u{E006D}e`]: ["val\u{E006C}ue"] };
  assert.deepEqual(sanitizeMcpValue(input), { name: ["value"] });
  assert.notStrictEqual(sanitizeMcpValue(input), input);
});

test("sanitizeMcpMetadata removes reserved MCP namespaces and keeps vendor data", () => {
  assert.deepEqual(sanitizeMcpMetadata({
    "io.modelcontextprotocol/related-task": { taskId: "secret" },
    "modelcontextprotocol.io/internal": true,
    "mcp/internal": true,
    "tools.mcp.com/internal": true,
    "vendor.example/request-id": `req\u{E0061}-1`,
  }), {
    "vendor.example/request-id": "req-1",
  });
});
