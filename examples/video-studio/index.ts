import { mkdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { config } from "dotenv";
import type { SubscriberAdapter } from "glove-core";
import { createVideoStudio } from "./studio";

config();

const outputDirectory = new URL("./out/", import.meta.url).pathname;
await mkdir(outputDirectory, { recursive: true });

const logger: SubscriberAdapter = {
  async record(event, data) {
    if (event === "text_delta") process.stdout.write((data as { text: string }).text);
    if (event === "tool_use") console.log(`\n  [tool] ${(data as { name: string }).name}`);
  },
};

const studio = await createVideoStudio({
  subscribers: [logger],
  onVideoProgress: (event) => {
    const percent = event.progress === undefined ? "" : ` ${Math.round(event.progress * 100)}%`;
    console.log(`  [video:${event.operation}] ${event.phase}${percent}`);
  },
});

const seenImages = new Set<string>();
const seenVideos = new Set<string>();

async function flushAssets(): Promise<void> {
  for (const image of await studio.imageAssets.list()) {
    if (seenImages.has(image.id)) continue;
    seenImages.add(image.id);
    const extension = image.mime === "image/jpeg" ? "jpg" : image.mime.split("/")[1] ?? "png";
    const path = `${outputDirectory}${image.name ?? image.id}.${extension}`;
    await writeFile(path, await studio.imageAssets.bytes(image.id));
    console.log(`  [saved image] ${path}`);
  }
  for (const video of await studio.videoAssets.list()) {
    if (seenVideos.has(video.id)) continue;
    const review = await studio.videoReviews.latest(video.id);
    if (review?.decision !== "pass") continue;
    seenVideos.add(video.id);
    const path = `${outputDirectory}${video.name ?? video.id}.mp4`;
    await writeFile(path, await studio.videoAssets.bytes(video.id));
    console.log(`  [saved approved video] ${path}`);
  }
}

console.log("video-studio — autonomous concept, generation, review, revision, and delivery. Ctrl-C to exit.\n");
console.log("Try: make me a memorable six-second cinematic micro-story; choose the subject and deliver only a reviewed result.\n");

const terminal = createInterface({ input: process.stdin, output: process.stdout });
for (;;) {
  const input = (await terminal.question("\n> ")).trim();
  if (!input) continue;
  if (input === "/cost") {
    console.log(JSON.stringify(studio.videoUsage.report(), null, 2));
    continue;
  }
  try {
    await studio.agent.processRequest(input);
    await flushAssets();
  } catch (error) {
    console.error("\n[error]", error instanceof Error ? error.message : error);
  }
}
