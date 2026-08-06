/**
 * `present` — the verb that turns a file in `/out` into a hand-off.
 *
 * The host callback is a stub here; what needs pinning is everything around
 * it. That the verb stays hidden until a host wires one. That `/out` is
 * enforced rather than suggested, because presenting from `/tmp` ships an
 * intermediate and presenting from `/inbox` echoes the person's own upload
 * back at them. And that the caption is required — the whole point of the
 * verb is that a filename is not a description.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createWorkingEnvironment, type PresentedFile } from "../src/index";

type Tool = { name: string; do: (input: unknown) => Promise<{ status: string; data?: unknown; message?: string }> };

/** Records the hand-off, so the test can assert on what the host received. */
function stubPresent() {
  const items: PresentedFile[] = [];
  return { items, onPresent: (item: PresentedFile) => void items.push(item) };
}

const presentOf = (tools: Array<{ name: string }>) => tools.find((t) => t.name === "present") as unknown as Tool;
const text = (s: string) => new TextEncoder().encode(s);

test("the verb is absent until a host wires a receiver", async () => {
  const env = await createWorkingEnvironment();
  try {
    assert.equal(
      env.tools.some((t) => t.name === "present"),
      false,
      "an agent must never be shown a hand-off with nowhere to hand off to",
    );
  } finally {
    await env.close();
  }
});

test("wiring onPresent adds the verb", async () => {
  const { onPresent } = stubPresent();
  const env = await createWorkingEnvironment({ onPresent });
  try {
    assert.ok(presentOf(env.tools), "present should be offered once a receiver exists");
  } finally {
    await env.close();
  }
});

test("the delivering skill travels with the verb, not without it", async () => {
  const bare = await createWorkingEnvironment();
  try {
    assert.equal(
      await bare.fs.exists("/skills/delivering.md"),
      false,
      "a recipe for a verb that is not offered would have the agent hallucinate the call",
    );
    assert.doesNotMatch(await bare.fs.readFile("/skills/README.md"), /delivering/);
  } finally {
    await bare.close();
  }

  const { onPresent } = stubPresent();
  const wired = await createWorkingEnvironment({ onPresent });
  try {
    const skill = await wired.fs.readFile("/skills/delivering.md");
    assert.match(skill, /present\(\{ path: '\/out\//);
    assert.match(skill, /caption/);
    assert.match(await wired.fs.readFile("/skills/README.md"), /delivering/);
  } finally {
    await wired.close();
  }
});

test("presenting a file in /out reaches the host with bytes, name and media type", async () => {
  const { items, onPresent } = stubPresent();
  const env = await createWorkingEnvironment({ onPresent });
  try {
    await env.mount(text("Q2 revenue by region"), "/out/report.pdf");
    const r = await presentOf(env.tools).do({ path: "/out/report.pdf", caption: "Q2 revenue, four regions." });

    assert.equal(r.status, "success", r.message);
    assert.equal(items.length, 1);
    assert.equal(items[0].path, "/out/report.pdf");
    assert.equal(items[0].name, "report.pdf");
    assert.equal(items[0].mediaType, "application/pdf");
    assert.equal(items[0].caption, "Q2 revenue, four regions.");
    assert.equal(new TextDecoder().decode(items[0].bytes), "Q2 revenue by region");
  } finally {
    await env.close();
  }
});

test("the media type follows the extension the agent chose", async () => {
  const { items, onPresent } = stubPresent();
  const env = await createWorkingEnvironment({ onPresent });
  try {
    const cases: Array<[string, string]> = [
      ["/out/deck.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
      ["/out/book.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
      ["/out/memo.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      ["/out/data.csv", "text/csv"],
      ["/out/notes.md", "text/markdown"],
      ["/out/chart.PNG", "image/png"],
      // A rendered animation is a deliverable like any other: the label is
      // what decides whether the person gets a player or a download prompt.
      ["/out/intro.mp4", "video/mp4"],
      ["/out/intro.webm", "video/webm"],
      ["/out/loop.gif", "image/gif"],
      ["/out/voiceover.mp3", "audio/mpeg"],
      ["/out/blob.wat", "application/octet-stream"],
    ];
    for (const [path] of cases) await env.mount(text("x"), path);
    for (const [path] of cases) {
      const r = await presentOf(env.tools).do({ path, caption: "a thing" });
      assert.equal(r.status, "success", `${path}: ${r.message}`);
    }
    assert.deepEqual(
      items.map((i) => i.mediaType),
      cases.map(([, expected]) => expected),
    );
  } finally {
    await env.close();
  }
});

test("an extensionless file falls back to sniffing the bytes", async () => {
  const { items, onPresent } = stubPresent();
  const env = await createWorkingEnvironment({ onPresent });
  try {
    await env.mount(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "/out/screenshot");
    const r = await presentOf(env.tools).do({ path: "/out/screenshot", caption: "the rendered page" });
    assert.equal(r.status, "success", r.message);
    assert.equal(items[0].mediaType, "image/png");
  } finally {
    await env.close();
  }
});

test("presenting from outside /out is refused, and the error carries the fix", async () => {
  const { items, onPresent } = stubPresent();
  const env = await createWorkingEnvironment({ onPresent });
  try {
    await env.mount(text("uploaded by the person"), "/inbox/theirs.pdf");
    await env.mount(text("scratch"), "/tmp/working.pdf");

    for (const path of ["/inbox/theirs.pdf", "/tmp/working.pdf"]) {
      const r = await presentOf(env.tools).do({ path, caption: "here you go" });
      assert.equal(r.status, "error", `${path} should not be presentable`);
      assert.match(String(r.message), /only works on files under \/out/);
      assert.match(String(r.message), /cp /, "the error must name the move that fixes it");
    }
    assert.equal(items.length, 0, "nothing may reach the host from a refused path");
  } finally {
    await env.close();
  }
});

test("/output is not /out — the prefix check is path-segment aware", async () => {
  const { onPresent } = stubPresent();
  const env = await createWorkingEnvironment({ onPresent });
  try {
    await env.mount(text("x"), "/output/report.pdf");
    const r = await presentOf(env.tools).do({ path: "/output/report.pdf", caption: "a thing" });
    assert.equal(r.status, "error");
    assert.match(String(r.message), /under \/out/);
  } finally {
    await env.close();
  }
});

test("a missing file and a directory fail differently", async () => {
  const { onPresent } = stubPresent();
  const env = await createWorkingEnvironment({ onPresent });
  try {
    const missing = await presentOf(env.tools).do({ path: "/out/nope.pdf", caption: "a thing" });
    assert.equal(missing.status, "error");
    assert.match(String(missing.message), /no such file/);

    await env.mount(text("x"), "/out/pages/one.png");
    const dir = await presentOf(env.tools).do({ path: "/out/pages", caption: "the pages" });
    assert.equal(dir.status, "error");
    assert.match(String(dir.message), /directory/);
  } finally {
    await env.close();
  }
});

test("an empty caption is refused with an example of a real one", async () => {
  const { items, onPresent } = stubPresent();
  const env = await createWorkingEnvironment({ onPresent });
  try {
    await env.mount(text("x"), "/out/report.pdf");
    const r = await presentOf(env.tools).do({ path: "/out/report.pdf", caption: "   " });
    assert.equal(r.status, "error");
    assert.match(String(r.message), /caption/);
    assert.match(String(r.message), /Example:/, "a refusal should show what a good caption looks like");
    assert.equal(items.length, 0);
  } finally {
    await env.close();
  }
});

test("a caption is trimmed, and the result line repeats it back", async () => {
  const { items, onPresent } = stubPresent();
  const env = await createWorkingEnvironment({ onPresent });
  try {
    await env.mount(text("0123456789"), "/out/report.pdf");
    const r = await presentOf(env.tools).do({ path: "/out/report.pdf", caption: "  Q2 revenue.  " });
    assert.equal(r.status, "success", r.message);
    assert.equal(items[0].caption, "Q2 revenue.");
    assert.match(String(r.data ?? r.message), /report\.pdf/);
    assert.match(String(r.data ?? r.message), /Q2 revenue\./);
  } finally {
    await env.close();
  }
});

test("a receiver that throws surfaces as a tool error, not a crash", async () => {
  const env = await createWorkingEnvironment({
    onPresent: () => {
      throw new Error("the delivery channel is down");
    },
  });
  try {
    await env.mount(text("x"), "/out/report.pdf");
    const r = await presentOf(env.tools).do({ path: "/out/report.pdf", caption: "a thing" });
    assert.equal(r.status, "error");
    assert.match(String(r.message), /delivery channel is down/);
  } finally {
    await env.close();
  }
});

test("an async receiver is awaited before the verb reports success", async () => {
  let settled = false;
  const env = await createWorkingEnvironment({
    onPresent: async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      settled = true;
    },
  });
  try {
    await env.mount(text("x"), "/out/report.pdf");
    const r = await presentOf(env.tools).do({ path: "/out/report.pdf", caption: "a thing" });
    assert.equal(r.status, "success", r.message);
    assert.equal(settled, true, "reporting delivery before the host has it would be a lie");
  } finally {
    await env.close();
  }
});
