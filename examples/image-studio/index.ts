/**
 * image-studio — an art-director agent built on `glove-image`.
 *
 * A headless REPL. You talk to it in plain language; it decides when to save
 * a character, generate, edit, regenerate, or assemble a sheet. Every image
 * it makes lands in ./out, and it can tell you what the session cost.
 *
 *   OPENROUTER_API_KEY=sk-or-... pnpm --filter glove-image-studio start
 *
 * Try:
 *   > create a character called mira, a wiry sky-courier with a patched flight jacket
 *   > draw her landing at a neon night market
 *   > same but at dawn
 *   > what did that cost?
 */

import { createInterface } from "node:readline/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import { config } from "dotenv";
import {
  Glove,
  Displaymanager,
  MemoryStore,
  createAdapter,
  type SubscriberAdapter,
} from "glove-core";
import {
  mountImage,
  InMemoryImageAssetStore,
  InMemoryImageLibrary,
  UsageMeter,
  expandCharacters,
  expandScenes,
  styleDirective,
  llmEnhance,
  openrouterImages,
} from "glove-image";

config();

const OUT_DIR = new URL("./out/", import.meta.url).pathname;
mkdirSync(OUT_DIR, { recursive: true });

if (!process.env.OPENROUTER_API_KEY) {
  console.error("Set OPENROUTER_API_KEY (https://openrouter.ai/keys) and re-run.");
  process.exit(1);
}

// ─── The pieces ────────────────────────────────────────────────────────────
// In production these two are the seams you replace: an ImageAssetStore over
// S3/disk, and an ImageLibraryAdapter over your database.
const assets = new InMemoryImageAssetStore();
const library = new InMemoryImageLibrary();
const meter = new UsageMeter();

// One text model drives both the agent and the pipeline's rewrite pass.
const textModel = () =>
  createAdapter({
    provider: "openrouter",
    model: "anthropic/claude-sonnet-4",
    stream: true,
  });

const glove = new Glove({
  store: new MemoryStore("image-studio"),
  model: textModel(),
  displayManager: new Displaymanager(),
  serverMode: true,
  systemPrompt: [
    "You are an art director with image tools.",
    "",
    "Working rules:",
    "- Recurring people go in the library as characters BEFORE you draw them;",
    "  recurring places go in as scenes. Write the appearance/setting blocks",
    "  prompt-ready, because they are spliced into prompts verbatim.",
    "- Refer to images by asset id. Never ask the user for image bytes.",
    "- For 'same but ...' requests use glove_image_regenerate with a tweak,",
    "  not a fresh generate — it replays the original recipe.",
    "- After generating, tell the user the asset id and what it cost.",
  ].join("\n"),
  compaction_config: {
    compaction_instructions:
      "Summarize the art direction so far: characters, scenes, and the asset ids produced.",
  },
});

await mountImage(glove, {
  adapter: openrouterImages({
    // Any OpenRouter image-output model. This is the default.
    model: "google/gemini-2.5-flash-image",
    title: "glove image-studio",
  }),
  assets,
  library,

  // The LLM slot llmEnhance() uses for its rewrite pass.
  model: createAdapter({
    provider: "openrouter",
    model: "openai/gpt-4o-mini",
    stream: false,
  }),

  // The middle of the pipeline. fitToModel() is appended automatically.
  pipeline: [
    expandCharacters(),
    expandScenes(),
    styleDirective("hand-painted gouache illustration, muted palette, soft rim light"),
    llmEnhance({ instructions: "Keep it under 120 words." }),
  ],

  // Vision is opt-in — it costs ~25k input tokens per look. Uncomment to let
  // the agent see and critique its own output.
  // review: {
  //   vision: createAdapter({ provider: "openrouter", model: "openai/gpt-4o-mini", stream: false }),
  //   rounds: 1,
  //   rubric: "Characters must match their appearance block. Flag anatomy errors.",
  // },

  usage: meter,
  onUsage: (source, u) =>
    console.log(
      `\n  [spend] ${source}: ${u.requests} req, ${u.tokens_in}→${u.tokens_out} tok` +
        (u.cost_usd !== undefined ? `, $${u.cost_usd.toFixed(4)}` : ""),
    ),
}).then(() => glove.build());

// Write every new asset to ./out so you can actually look at the results.
const seen = new Set<string>();
async function flushNewAssets(): Promise<void> {
  for (const asset of await assets.list()) {
    if (seen.has(asset.id)) continue;
    seen.add(asset.id);
    const ext = asset.mime.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
    const file = `${OUT_DIR}${asset.name ?? asset.id}.${ext}`;
    writeFileSync(file, await assets.bytes(asset.id));
    console.log(`  [saved] ${file}`);
  }
}

const logger: SubscriberAdapter = {
  async record(event_type, data) {
    if (event_type === "text_delta") process.stdout.write((data as { text: string }).text);
    if (event_type === "tool_use") console.log(`\n  [tool] ${(data as { name: string }).name}`);
  },
};
glove.addSubscriber(logger);

// ─── REPL ──────────────────────────────────────────────────────────────────
console.log("image-studio — describe what you want. Ctrl-C to exit.\n");

const rl = createInterface({ input: process.stdin, output: process.stdout });
for (;;) {
  const line = (await rl.question("\n> ")).trim();
  if (!line) continue;
  if (line === "/cost") {
    console.log(JSON.stringify(meter.report(), null, 2));
    continue;
  }
  try {
    await glove.processRequest(line);
    await flushNewAssets();
  } catch (err) {
    console.error("\n[error]", err instanceof Error ? err.message : err);
  }
}
