import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import type { GloveFoldArgs } from "glove-core/glove";
import { resourceFromTool, defineResource } from "../src/db/resource";
import { makeBindings } from "../src/db/provider";

const ctx = () => ({ cache: new Map<string, unknown>() });

test("resourceFromTool: get_time → a one-row 'time' table", async () => {
  const tool: GloveFoldArgs<Record<string, never>> = {
    name: "get_time",
    description: "current time",
    inputSchema: z.object({}),
    async do() {
      return { status: "success", data: { now: "2026-06-29T00:00:00Z" } };
    },
  };
  const time = resourceFromTool(tool, {
    name: "time",
    volatility: "stable",
    columns: [{ name: "now", type: "timestamptz" }],
  });
  assert.equal(time.name, "time");
  assert.deepEqual(time.columns.map((c) => c.name), ["now"]);
  assert.ok(time.select && !time.insert);
  const rows = await time.select!(makeBindings(new Map()), ctx());
  assert.deepEqual(rows, { now: "2026-06-29T00:00:00Z" });
});

test("resourceFromTool: a required Zod input becomes a required-key column", async () => {
  const tool: GloveFoldArgs<{ query: string }> = {
    name: "search",
    description: "web search",
    inputSchema: z.object({ query: z.string() }),
    async do(input) {
      return { status: "success", data: [{ title: `re: ${input.query}`, url: "https://x" }] };
    },
  };
  const web = resourceFromTool(tool, {
    name: "web",
    volatility: "volatile",
    columns: [{ name: "title", type: "text" }, { name: "url", type: "text" }],
  });
  const query = web.columns.find((c) => c.name === "query");
  assert.ok(query, "query column derived from the tool input");
  assert.equal(query!.requiredKey, true);
  const rows = await web.select!(makeBindings(new Map([["query", ["sql"]]])), ctx());
  assert.deepEqual(rows, [{ title: "re: sql", url: "https://x" }]);
});

test("resourceFromTool: send_email → an INSERT-only 'emails' resource", async () => {
  const sent: unknown[] = [];
  const tool: GloveFoldArgs<{ to_addr: string; subject: string; body: string }> = {
    name: "send_email",
    description: "send an email",
    inputSchema: z.object({ to_addr: z.string(), subject: z.string(), body: z.string() }),
    async do(input) {
      sent.push(input);
      return { status: "success", data: { id: "msg_1" } };
    },
  };
  const emails = resourceFromTool(tool, {
    name: "emails",
    op: "insert",
    volatility: "volatile",
    columns: [{ name: "to_addr", type: "text" }, { name: "subject", type: "text" }, { name: "body", type: "text" }],
  });
  assert.ok(emails.insert && !emails.select);
  await emails.insert!([{ to_addr: "a@b.com", subject: "hi", body: "yo" }], ctx());
  assert.deepEqual(sent, [{ to_addr: "a@b.com", subject: "hi", body: "yo" }]);
});

test("resourceFromTool: a volatile SELECT must declare columns", () => {
  const tool: GloveFoldArgs<{ q: string }> = {
    name: "x",
    description: "",
    inputSchema: z.object({ q: z.string() }),
    async do() {
      return { status: "success", data: [] };
    },
  };
  assert.throws(() => resourceFromTool(tool, { name: "x", volatility: "volatile" }), /must declare columns/);
});

test("resourceFromTool: a failing tool surfaces as a thrown error", async () => {
  const tool: GloveFoldArgs<Record<string, never>> = {
    name: "boom",
    description: "",
    inputSchema: z.object({}),
    async do() {
      return { status: "error", message: "kaboom", data: null };
    },
  };
  const r = resourceFromTool(tool, { name: "boom", volatility: "stable", columns: [{ name: "x", type: "text" }] });
  await assert.rejects(() => r.select!(makeBindings(new Map()), ctx()), /kaboom/);
});

test("defineResource validates its shape", () => {
  assert.throws(() => defineResource({ name: "", columns: [], volatility: "stable" }), /name is required/);
  assert.throws(
    () => defineResource({ name: "t", columns: [], volatility: "stable", select: async () => [] }),
    /at least one column/,
  );
  assert.throws(
    () => defineResource({ name: "t", columns: [{ name: "x", type: "text" }], volatility: "stable" }),
    /at least one of select/,
  );
});
