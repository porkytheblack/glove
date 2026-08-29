import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeStormId } from "../../lib/storm-id.js";

const here = dirname(fileURLToPath(import.meta.url));
const exampleRoot = resolve(here, "../..");

const BRIEFING_FILES = [
  ["Lead recommendation", "00-lead-recommendation.md"],
  ["Positioning and go-to-market", "02-positioning-gtm.md"],
  ["Creative direction", "03-creative-direction.md"],
  ["Creative review", "05-creative-review.md"],
] as const;

function stormRoot(stormId: string): string {
  return resolve(exampleRoot, ".braind-storm", "workspaces", normalizeStormId(stormId));
}

async function optionalText(path: string, limit: number): Promise<string | null> {
  try {
    return (await readFile(path, "utf8")).trim().slice(0, limit);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export interface BriefingSnapshot {
  readonly stormId: string;
  readonly state: "empty" | "in-progress" | "ready";
  readonly sections: ReadonlyArray<{ readonly title: string; readonly content: string }>;
  readonly recordedDirections: ReadonlyArray<string>;
  readonly artifacts: ReadonlyArray<{ readonly name: string; readonly bytes: number }>;
}

export async function readBriefingSnapshot(stormId: string, detail: "headline" | "full"): Promise<BriefingSnapshot> {
  const id = normalizeStormId(stormId);
  const root = stormRoot(id);
  const out = resolve(root, "out");
  const perFileLimit = detail === "full" ? 8_000 : 2_500;
  const sections: Array<{ title: string; content: string }> = [];
  for (const [title, name] of BRIEFING_FILES) {
    const content = await optionalText(resolve(out, name), perFileLimit);
    if (content) sections.push({ title, content });
  }

  const voiceDir = resolve(root, "inbox", "voice");
  const directionNames = await readdir(voiceDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const recordedDirections = (await Promise.all(directionNames.sort().slice(-10).map((name) => optionalText(resolve(voiceDir, name), 2_000))))
    .filter((value): value is string => Boolean(value));

  const artifactNames = await readdir(out).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const artifacts = await Promise.all(artifactNames.sort().map(async (name) => ({
    name,
    bytes: (await stat(resolve(out, name))).size,
  })));

  return {
    stormId: id,
    state: sections.some((section) => section.title === "Lead recommendation")
      ? "ready"
      : sections.length || artifacts.length
        ? "in-progress"
        : "empty",
    sections,
    recordedDirections,
    artifacts,
  };
}

export async function recordVoiceDirection(input: {
  stormId: string;
  direction: string;
  priority: "note" | "important" | "urgent";
  appliesTo: string;
}): Promise<{ stormId: string; path: string; recordedAt: string }> {
  const id = normalizeStormId(input.stormId);
  const voiceDir = resolve(stormRoot(id), "inbox", "voice");
  await mkdir(voiceDir, { recursive: true });
  const recordedAt = new Date().toISOString();
  const name = `${recordedAt.replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}.md`;
  const body = [
    "# Direction from the live briefing line",
    "",
    `- Recorded: ${recordedAt}`,
    `- Priority: ${input.priority}`,
    `- Applies to: ${input.appliesTo}`,
    "",
    input.direction.trim(),
    "",
  ].join("\n");
  await writeFile(resolve(voiceDir, name), body, "utf8");
  return { stormId: id, path: `/inbox/voice/${name}`, recordedAt };
}
