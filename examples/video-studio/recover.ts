import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { inspectMp4Metadata } from "glove-video";

config({ quiet: true });

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  throw new Error("Set OPENROUTER_API_KEY before recovering generated videos.");
}

const defaultJobs = [
  { id: "gqZpcXMs8sjbaxznbJ5R", label: "draft-1" },
  { id: "GNNZ5tKNV9peXZGFc0Hq", label: "draft-2" },
  { id: "Vgk1tHpOzXgAu20kxHgQ", label: "draft-3" },
  { id: "jdGteGPDNOC6EN0GFLNu", label: "final-attempt" },
];
const requestedIds = process.argv.slice(2).filter((value) => !value.startsWith("--"));
const jobs = requestedIds.length
  ? requestedIds.map((id, index) => ({ id, label: `recovered-${index + 1}` }))
  : defaultJobs;

const baseUrl = "https://openrouter.ai/api/v1";
const baseOrigin = new URL(baseUrl).origin;
const outputDirectory = fileURLToPath(new URL("./out/showcase/rejected/", import.meta.url));
await mkdir(outputDirectory, { recursive: true });

function requestHeaders(url: string): Record<string, string> {
  return new URL(url).origin === baseOrigin
    ? { Authorization: `Bearer ${apiKey}` }
    : {};
}

async function responseError(response: Response): Promise<Error> {
  const detail = (await response.text()).slice(0, 500);
  return new Error(`OpenRouter ${response.status}${detail ? `: ${detail}` : ""}`);
}

const recovered = [];
for (const job of jobs) {
  const infoUrl = `${baseUrl}/videos/${job.id}`;
  const infoResponse = await fetch(infoUrl, { headers: requestHeaders(infoUrl) });
  if (!infoResponse.ok) throw await responseError(infoResponse);
  const info = (await infoResponse.json()) as {
    status?: string;
    unsigned_urls?: string[];
  };
  if (info.status !== "completed") {
    throw new Error(`Video job ${job.id} is ${info.status ?? "in an unknown state"}, not completed.`);
  }

  const contentUrl = new URL(
    info.unsigned_urls?.[0] ?? `${baseUrl}/videos/${job.id}/content?index=0`,
    `${baseUrl}/`,
  ).href;
  const contentResponse = await fetch(contentUrl, { headers: requestHeaders(contentUrl) });
  if (!contentResponse.ok) throw await responseError(contentResponse);
  const mime = contentResponse.headers.get("content-type")?.split(";")[0] ?? "video/mp4";
  if (!mime.startsWith("video/")) {
    throw new Error(`Video job ${job.id} returned unexpected content type ${mime}.`);
  }

  const bytes = new Uint8Array(await contentResponse.arrayBuffer());
  const extension = mime === "video/webm" ? "webm" : "mp4";
  const path = join(outputDirectory, `${job.label}-${job.id}.${extension}`);
  await writeFile(path, bytes);
  recovered.push({
    id: job.id,
    label: job.label,
    path,
    mime,
    bytes: bytes.byteLength,
    ...(mime === "video/mp4" ? inspectMp4Metadata(bytes) : {}),
  });
}

console.log(JSON.stringify({ recovered }, null, 2));
