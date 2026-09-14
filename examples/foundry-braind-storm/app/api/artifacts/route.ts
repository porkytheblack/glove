import { readFile, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { NextResponse } from "next/server";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..", ".braind-storm", "workspaces");
const MIME: Record<string, string> = {
  ".md": "text/markdown; charset=utf-8",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const storm = (url.searchParams.get("storm") ?? "").replace(/[^a-z0-9-]/gi, "");
  const path = url.searchParams.get("path") ?? "";
  if (!storm || !path.startsWith("/out/")) return NextResponse.json({ error: "Invalid artifact path." }, { status: 400 });
  const file = resolve(root, storm, path.slice(1));
  const stormRoot = resolve(root, storm);
  if (file !== stormRoot && !file.startsWith(stormRoot + sep)) return NextResponse.json({ error: "Invalid artifact path." }, { status: 400 });
  try {
    const bytes = await readFile(file);
    const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
    const info = await stat(file);
    return new NextResponse(bytes, {
      headers: {
        "content-type": MIME[ext] ?? "application/octet-stream",
        "content-length": String(info.size),
        "content-disposition": ext === ".png" ? "inline" : `attachment; filename="${file.split(sep).at(-1)}"`,
        "cache-control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Artifact not found." }, { status: 404 });
  }
}
