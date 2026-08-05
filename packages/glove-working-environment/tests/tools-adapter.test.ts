/**
 * `defineTools` — capabilities as an `env:` module.
 *
 * The point of the adapter is that a script can hold a capability's result in
 * a variable instead of in the context window, so the tests are mostly about
 * the seams that make that safe: identifiers that can actually be imported,
 * arguments that survive the worker boundary intact, a read-only pass that
 * cannot fire a real effect, and generated types the audit harness agrees
 * with.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createWorkingEnvironment, defineTools, type ToolFn } from "../src/index";
import { assertAdapterOk, createAdapterTestEnv } from "../src/testing";

/** A capability plus the log of how it was called. */
function spy(name: string, impl?: (args: Record<string, unknown>) => unknown): ToolFn & { calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  return {
    name,
    description: `Stub ${name}.`,
    calls,
    async call(args) {
      calls.push(args);
      return impl ? impl(args) : { ok: true, name, args };
    },
  };
}

const listPrs: ToolFn = {
  name: "list_pull_requests",
  description: "List pull requests for a repository.",
  server: "github",
  serverDescription: "GitHub: repositories, pull requests and issues.",
  readOnlyHint: true,
  inputSchema: {
    type: "object",
    properties: {
      repo: { type: "string", description: "owner/name" },
      state: { type: "string", enum: ["open", "closed", "merged"] },
      limit: { type: "integer" },
      draft: { type: "boolean" },
    },
    required: ["repo"],
  },
  resultShape: "Array<{ number: number; title: string }>",
  async call(args) {
    return [{ number: 1, title: `pr in ${(args as { repo?: string }).repo}` }];
  },
};

test("a script imports capabilities and keeps the result in a variable", async () => {
  const gh = spy("list_issues", () => [{ id: 1 }, { id: 2 }, { id: 3 }]);
  const { runScript, env } = await createAdapterTestEnv(defineTools({ name: "github", fns: [gh] }));
  try {
    const r = await runScript(
      `import { list_issues } from 'env:github';
       export default async function () {
         const issues = await list_issues({ repo: 'porkytheblack/glove' });
         return { count: issues.length };
       }`,
    );
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(r.result, { count: 3 });
    assert.deepEqual(gh.calls, [{ repo: "porkytheblack/glove" }]);
  } finally {
    await env.close();
  }
});

test("arguments arrive as plain data across the worker boundary", async () => {
  const seen = spy("submit");
  const { runScript, env } = await createAdapterTestEnv(defineTools({ name: "api", fns: [seen] }));
  try {
    const r = await runScript(
      `import { submit } from 'env:api';
       export default async function () {
         await submit({ nested: { list: [1, 2, { deep: true }] }, when: '2026-08-05' });
         return 'sent';
       }`,
    );
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(seen.calls[0], { nested: { list: [1, 2, { deep: true }] }, when: "2026-08-05" });
  } finally {
    await env.close();
  }
});

test("calling with no arguments hands the capability an empty object, never undefined", async () => {
  const now = spy("now", () => "2026-08-05T00:00:00Z");
  const { runScript, env } = await createAdapterTestEnv(defineTools({ name: "clock", fns: [now] }));
  try {
    const r = await runScript(
      `import { now } from 'env:clock';
       export default async function () { return await now(); }`,
    );
    assert.equal(r.ok, true, r.error);
    assert.equal(r.result, "2026-08-05T00:00:00Z");
    assert.deepEqual(now.calls, [{}], "a capability that reads args.foo must not have to guard against undefined");
  } finally {
    await env.close();
  }
});

test("a capability that throws fails the script with the module and function named", async () => {
  const broken: ToolFn = {
    name: "send_email",
    async call() {
      throw new Error("SMTP refused the connection");
    },
  };
  const { runScript, env } = await createAdapterTestEnv(defineTools({ name: "mail", fns: [broken] }));
  try {
    const r = await runScript(
      `import { send_email } from 'env:mail';
       export default async function () { await send_email({ to: 'a@b.c' }); }`,
    );
    assert.equal(r.ok, false);
    assert.match(String(r.error), /env:mail\.send_email/);
    assert.match(String(r.error), /SMTP refused the connection/);
  } finally {
    await env.close();
  }
});

test("write-time validation cannot fire a real effect", async () => {
  const send = spy("send_email");
  const env = await createWorkingEnvironment({ stdlib: [defineTools({ name: "mail", fns: [send] })] });
  try {
    // A top-level call runs during validation, which happens on every write.
    // For a filesystem adapter that is merely wasteful; for a capability it
    // would mean the email goes out when the script is saved.
    const write = env.tools.find((t) => t.name === "write_file")!;
    const r = await write.do({
      path: "/scripts/blast.js",
      content:
        `import { send_email } from 'env:mail';\n` +
        `await send_email({ to: 'everyone@example.com' });\n` +
        `export default async function () { return 'done'; }\n`,
    });
    assert.equal(r.status, "error");
    assert.match(String(r.message), /not callable while a script is being validated/);
    assert.equal(send.calls.length, 0, "validating a script must never send an email");
  } finally {
    await env.close();
  }
});

test("generated types match the real bindings, in both directions", async () => {
  const { audit, env } = await createAdapterTestEnv(defineTools({ name: "github", fns: [listPrs, spy("create_issue")] }));
  try {
    const report = await audit();
    assertAdapterOk(report);
    assert.deepEqual(report.errors, []);
    assert.deepEqual([...report.bindings].sort(), ["create_issue", "list_pull_requests"]);
  } finally {
    await env.close();
  }
});

test("the .d.ts carries the schema through as real TypeScript", async () => {
  const { fs, env } = await createAdapterTestEnv(defineTools({ name: "github", fns: [listPrs] }));
  try {
    const dts = await fs.readFile("/std/github/index.d.ts");
    assert.match(dts, /export function list_pull_requests\(/);
    assert.match(dts, /repo: string/);
    assert.match(dts, /state\?: "open" \| "closed" \| "merged"/, "an enum should reach the model as a union, not as string");
    assert.match(dts, /limit\?: number/, "integer is a number in TypeScript");
    assert.match(dts, /draft\?: boolean/);
    assert.match(dts, /Promise<Array<\{ number: number; title: string \}>>/);
    assert.match(dts, /ASYNC/, "the one mistake worth shouting about is a missing await");
  } finally {
    await env.close();
  }
});

test("a capability with no declared arguments takes an optional object", async () => {
  const { fs, env } = await createAdapterTestEnv(defineTools({ name: "clock", fns: [spy("now")] }));
  try {
    const dts = await fs.readFile("/std/clock/index.d.ts");
    assert.match(dts, /export function now\(args\?: Record<string, any>\)/);
  } finally {
    await env.close();
  }
});

test("the README lists every capability and shows a concrete call", async () => {
  const { fs, env } = await createAdapterTestEnv(defineTools({ name: "github", fns: [listPrs, spy("create_issue")] }));
  try {
    const readme = await fs.readFile("/std/github/README.md");
    assert.match(readme, /import \{ list_pull_requests, create_issue \} from 'env:github'/);
    assert.match(readme, /- `list_pull_requests\(…\)` — List pull requests for a repository\./);
    assert.match(readme, /- `create_issue\(…\)`/);
    assert.match(readme, /await list_pull_requests\(\{ repo: '…' \}\)/, "the example should use the required argument");
    assert.match(readme, /always `await`/);
  } finally {
    await env.close();
  }
});

test("host prose is appended to the generated docs", async () => {
  const { fs, env } = await createAdapterTestEnv(
    defineTools({
      name: "github",
      fns: [listPrs],
      docs: "## This account\n\nTokens belong to the glove bot; it can read every repo in the org but write to none.",
    }),
  );
  try {
    const readme = await fs.readFile("/std/github/README.md");
    assert.match(readme, /Tokens belong to the glove bot/);
    assert.match(readme, /- `list_pull_requests\(…\)`/, "host prose adds to the generated part, it does not replace it");
  } finally {
    await env.close();
  }
});

test("the module description falls back to the server's own", async () => {
  const { env } = await createAdapterTestEnv(defineTools({ name: "github", fns: [listPrs] }));
  try {
    const ls = env.tools.find((t) => t.name === "ls")!;
    const r = await ls.do({ path: "/std" });
    assert.equal(r.status, "success", r.message);
    assert.match(String(r.data ?? r.message), /GitHub: repositories, pull requests and issues\./);
  } finally {
    await env.close();
  }
});

test("a name a script could not import is refused at mount time", () => {
  for (const bad of ["list-issues", "github.list", "2fast", "", "with space"]) {
    assert.throws(
      () => defineTools({ name: "x", fns: [{ name: bad, async call() {} }] }),
      /not a valid identifier/,
      `"${bad}" binds to nothing, so it must fail here rather than produce an unimportable module`,
    );
  }
  // MCP's `server__tool` convention is already a valid identifier.
  assert.doesNotThrow(() => defineTools({ name: "x", fns: [{ name: "github__list_issues", async call() {} }] }));
});

test("duplicates, empties and non-callables are refused at mount time", () => {
  assert.throws(() => defineTools({ name: "x", fns: [] }), /non-empty array/);
  assert.throws(
    () => defineTools({ name: "x", fns: [spy("a"), spy("a")] }),
    /duplicate function name "a"/,
  );
  assert.throws(
    () => defineTools({ name: "x", fns: [{ name: "a" } as unknown as ToolFn] }),
    /needs a call\(args\) function/,
  );
});

test("capabilities sit beside the format adapters, so one script does both", async () => {
  const inbox: ToolFn = {
    name: "list_emails",
    async call() {
      return [
        { subject: "Q2 numbers", from: "cfo@example.com" },
        { subject: "Deck review", from: "design@example.com" },
      ];
    },
  };
  const env = await createWorkingEnvironment({ stdlib: [defineTools({ name: "mail", fns: [inbox] })] });
  try {
    const write = env.tools.find((t) => t.name === "write_file")!;
    const run = env.tools.find((t) => t.name === "run_script")!;
    const w = await write.do({
      path: "/scripts/digest.js",
      content:
        `import { list_emails } from 'env:mail';\n` +
        `import { writeFile } from 'env:fs';\n` +
        `export default async function () {\n` +
        `  const emails = await list_emails({ since: '2026-08-01' });\n` +
        `  await writeFile('/out/digest.md', emails.map(e => '- ' + e.subject).join('\\n'));\n` +
        `  return emails.length;\n` +
        `}\n`,
    });
    assert.equal(w.status, "success", w.message);
    const r = await run.do({ path: "/scripts/digest.js" });
    assert.equal(r.status, "success", r.message);
    assert.equal(await env.fs.readFile("/out/digest.md"), "- Q2 numbers\n- Deck review");
  } finally {
    await env.close();
  }
});
