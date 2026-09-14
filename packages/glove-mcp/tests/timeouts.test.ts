import assert from "node:assert/strict";
import { test } from "node:test";
import {
  connectMcp,
  DEFAULT_MCP_CONNECT_TIMEOUT_MS,
  DEFAULT_MCP_REQUEST_TIMEOUT_MS,
} from "../src/index.js";

test("MCP timeout defaults are finite", () => {
  assert.equal(DEFAULT_MCP_CONNECT_TIMEOUT_MS, 30_000);
  assert.equal(DEFAULT_MCP_REQUEST_TIMEOUT_MS, 60_000);
});

test("invalid MCP timeouts fail before transport connection", async () => {
  await assert.rejects(
    connectMcp({ namespace: "invalid", url: "https://example.invalid/mcp", connectTimeoutMs: 0 }),
    /connectTimeoutMs must be a positive integer/,
  );
  await assert.rejects(
    connectMcp({ namespace: "invalid", url: "https://example.invalid/mcp", requestTimeoutMs: 1.5 }),
    /requestTimeoutMs must be a positive integer/,
  );
});
