import assert from "node:assert/strict";
import { test } from "node:test";
import type { IncomingMessage } from "node:http";
import { execFileSync } from "node:child_process";
import { allowedRequest, shellQuote } from "../lib/http.js";
const request = (method: string, host: string, origin?: string) => ({ method, headers: { host, ...(origin ? { origin } : {}) } }) as IncomingMessage;
test("private console rejects cross-origin writes and rebinding hosts", () => {
  assert.equal(allowedRequest(request("GET", "127.0.0.1:4243"), 4243), true);
  assert.equal(allowedRequest(request("POST", "127.0.0.1:4243", "http://127.0.0.1:4243"), 4243), true);
  assert.equal(allowedRequest(request("POST", "127.0.0.1:4243", "https://elsewhere.example"), 4243), false);
  assert.equal(allowedRequest(request("POST", "127.0.0.1:4243"), 4243), false);
  assert.equal(allowedRequest(request("GET", "rebound.example:4243"), 4243), false);
  assert.equal(allowedRequest(request("POST", "127.0.0.1:4243", "null"), 4243), false);
});
test("preview command quotes URL-derived text without evaluating shell substitutions", () => {
  const value = "A 'quoted' value with $(echo unexpected) and `echo unexpected`\nnext line";
  assert.equal(execFileSync("/bin/sh", ["-c", `printf %s ${shellQuote(value)}`], { encoding: "utf8" }), value);
});
