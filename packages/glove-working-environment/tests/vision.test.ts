/**
 * `view_image` — the verb that lets an agent check its own work by looking at
 * it.
 *
 * The vision model is a stub here on purpose: what needs pinning is the
 * plumbing around it — that the verb is absent until a host wires one, that
 * bytes reach it with an honest media type, that a document is rasterized on
 * the way, and that every failure names its fix.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createWorkingEnvironment, defineAdapter, type VisionAdapter } from "../src/index";

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = (tag = "") => new Uint8Array([...PNG_HEADER, ...new TextEncoder().encode(tag)]);
const pdf = () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

/** Records what it was asked, so the test can assert on the handoff. */
function stubVision() {
  const calls: Array<{ mediaType: string; prompt: string; bytes: number; tag: string }> = [];
  const adapter: VisionAdapter = {
    async describe({ bytes, mediaType, prompt }) {
      calls.push({
        mediaType,
        prompt,
        bytes: bytes.byteLength,
        tag: new TextDecoder().decode(bytes.subarray(PNG_HEADER.length)),
      });
      return `saw a ${mediaType} of ${bytes.byteLength} bytes; asked: ${prompt}`;
    },
  };
  return { adapter, calls };
}

/** A renderer that turns anything into a one-pixel PNG, without pdfjs. */
const stubRenderer = () =>
  defineAdapter({
    name: "render",
    description: "Stub rasterizer.",
    types: `export function render(input: string, outDir: string, opts?: unknown): Promise<{ pages: Array<{ path: string }> }>;`,
    renders: { extensions: [".pdf", ".pptx"], magic: [{ bytes: [0x25, 0x50, 0x44, 0x46] }] },
    create(vfs) {
      return {
        async render(_input: string, outDir: string) {
          const out = `${outDir}/page-1.png`;
          await vfs.mkdir(outDir);
          await vfs.writeFile(out, png("rendered"));
          return { pages: [{ path: out, page: 1 }] };
        },
      };
    },
  });

const namesOf = (tools: Array<{ name: string }>) => tools.map((t) => t.name);
const viewOf = (tools: Array<{ name: string; do: (i: unknown) => Promise<{ status: string; data?: unknown; message?: string }> }>) =>
  tools.find((t) => t.name === "view_image")!;

test("the verb is absent until a host wires a vision model", async () => {
  const env = await createWorkingEnvironment();
  try {
    assert.equal(namesOf(env.tools).includes("view_image"), false, "an agent must never be shown a capability that would fail on use");
  } finally {
    await env.close();
  }
});

test("wiring a vision model adds the verb", async () => {
  const { adapter } = stubVision();
  const env = await createWorkingEnvironment({ vision: adapter });
  try {
    assert.ok(namesOf(env.tools).includes("view_image"));
    assert.ok(namesOf(env.toolsWithPrefix("env_")).includes("env_view_image"), "the prefixed set must carry it too");
  } finally {
    await env.close();
  }
});

test("an image goes straight to the model, with its real media type", async () => {
  const { adapter, calls } = stubVision();
  const env = await createWorkingEnvironment({ vision: adapter });
  try {
    await env.mount(png("original"), "/out/chart.png");
    const result = await viewOf(env.tools).do({ path: "/out/chart.png", prompt: "Are there four bars?" });

    assert.equal(result.status, "success");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].mediaType, "image/png");
    assert.equal(calls[0].tag, "original", "the file's own bytes must reach the model, unrendered");
    assert.equal(calls[0].prompt, "Are there four bars?");
    assert.match(String(result.data), /asked: Are there four bars\?/);
  } finally {
    await env.close();
  }
});

test("a document is rasterized on the way, and the render is reported", async () => {
  const { adapter, calls } = stubVision();
  const env = await createWorkingEnvironment({ vision: adapter, stdlib: [stubRenderer()] });
  try {
    await env.mount(pdf(), "/out/report.pdf");
    const result = await viewOf(env.tools).do({ path: "/out/report.pdf", prompt: "Is the total visible?" });

    assert.equal(result.status, "success");
    assert.equal(calls[0].tag, "rendered", "the model must see the render, not the PDF bytes");
    assert.equal(calls[0].mediaType, "image/png");
    // Provenance matters: the agent has to know it looked at a picture of
    // page 1, not at the document.
    assert.match(String(result.data), /rendered \/out\/report\.pdf -> \/tmp\/\.view\//);
  } finally {
    await env.close();
  }
});

test("renders land outside /out, so the deliverable directory stays honest", async () => {
  const { adapter } = stubVision();
  const env = await createWorkingEnvironment({ vision: adapter, stdlib: [stubRenderer()] });
  try {
    await env.mount(pdf(), "/out/report.pdf");
    await viewOf(env.tools).do({ path: "/out/report.pdf", prompt: "anything" });
    const delivered = await env.export("/out/**");
    assert.deepEqual(delivered.map((f) => f.path), ["/out/report.pdf"]);
  } finally {
    await env.close();
  }
});

test("without a renderer, the error names the package that would fix it", async () => {
  const { adapter } = stubVision();
  const env = await createWorkingEnvironment({ vision: adapter });
  try {
    await env.mount(pdf(), "/out/report.pdf");
    const result = await viewOf(env.tools).do({ path: "/out/report.pdf", prompt: "Is it right?" });
    assert.equal(result.status, "error");
    assert.match(String(result.message), /not an image/);
    assert.match(String(result.message), /glove-env-render/);
  } finally {
    await env.close();
  }
});

test("format is decided by magic bytes, not by the extension", async () => {
  const { adapter, calls } = stubVision();
  const env = await createWorkingEnvironment({ vision: adapter, stdlib: [stubRenderer()] });
  try {
    // A PDF wearing a .png name must not be handed over as a PNG — the
    // provider would reject it and blame the media type.
    await env.mount(pdf(), "/out/liar.png");
    const result = await viewOf(env.tools).do({ path: "/out/liar.png", prompt: "what is this" });
    assert.equal(result.status, "success");
    assert.equal(calls[0].tag, "rendered", "it should have been rasterized despite the .png name");
  } finally {
    await env.close();
  }
});

test("an empty prompt is refused with an example, not silently answered", async () => {
  const { adapter, calls } = stubVision();
  const env = await createWorkingEnvironment({ vision: adapter });
  try {
    await env.mount(png(), "/out/chart.png");
    const result = await viewOf(env.tools).do({ path: "/out/chart.png", prompt: "   " });
    assert.equal(result.status, "error");
    assert.match(String(result.message), /what to check/);
    assert.match(String(result.message), /Example:/);
    assert.equal(calls.length, 0, "no model call should have been made");
  } finally {
    await env.close();
  }
});

test("a missing file and a directory each fail as themselves", async () => {
  const { adapter } = stubVision();
  const env = await createWorkingEnvironment({ vision: adapter });
  try {
    const view = viewOf(env.tools);
    assert.match(String((await view.do({ path: "/out/ghost.png", prompt: "x" })).message), /no such file/);
    assert.match(String((await view.do({ path: "/out", prompt: "x" })).message), /is a directory/);
  } finally {
    await env.close();
  }
});

test("a vision model that throws surfaces as a tool error, not a crash", async () => {
  const env = await createWorkingEnvironment({
    vision: {
      async describe() {
        throw new Error("429 rate limited");
      },
    },
  });
  try {
    await env.mount(png(), "/out/chart.png");
    const result = await viewOf(env.tools).do({ path: "/out/chart.png", prompt: "check it" });
    assert.equal(result.status, "error");
    assert.match(String(result.message), /429 rate limited/);
  } finally {
    await env.close();
  }
});

test("declaring renders without a render binding fails at creation", async () => {
  const broken = defineAdapter({
    name: "broken",
    description: "Claims to render, exposes nothing.",
    types: `export function nope(): void;`,
    renders: { extensions: [".pdf"] },
    create() {
      return { nope() {} };
    },
  });
  await assert.rejects(
    () => createWorkingEnvironment({ stdlib: [broken] }),
    /declares renders but exposes no render\(\) binding/,
  );
});
