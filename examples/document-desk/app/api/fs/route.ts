/**
 * The tree, and one file's content.
 *
 * Read straight off the environment's guarded handle — the same gateway the
 * model's verbs go through, so the browser cannot see anything the agent
 * could not.
 */
import { peekDesk } from "@/lib/desk";
import { mediaTypeOf } from "@/lib/mime";
import type { TreeNode } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TEXTUAL = /\.(md|txt|json|js|ts|d\.ts|csv|jsonl|html|xml|yml|yaml|log)$/i;

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session") ?? "";
  const path = url.searchParams.get("path");

  const desk = peekDesk(sessionId);
  // A session with no desk yet is not an error — it is an empty tree.
  if (!desk) return Response.json({ nodes: [] });

  if (path) {
    // One file's content, for the preview pane.
    try {
      const stat = await desk.env.fs.stat(path);
      if (!stat || stat.kind !== "file") return Response.json({ error: "not a file" }, { status: 404 });
      if (!TEXTUAL.test(path)) {
        // Binary, but not necessarily opaque — the media type decides whether
        // the preview pane can show it or has to offer a download.
        return Response.json({ path, binary: true, size: stat.size, mediaType: mediaTypeOf(path) });
      }
      // Cap it: a 200KB extracted-text file should not be shipped to the
      // browser in full just because someone clicked it.
      const text = await desk.env.fs.readFile(path);
      const capped = text.length > 60_000;
      return Response.json({
        path,
        binary: false,
        size: stat.size,
        mediaType: mediaTypeOf(path),
        text: capped ? `${text.slice(0, 60_000)}\n\n… truncated (${text.length} chars total)` : text,
      });
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 404 });
    }
  }

  // The whole tree, flat. It is small enough that the client can build the
  // hierarchy itself, and a flat list is much easier to diff on refresh.
  const files = await desk.env.fs.glob("/**");
  const nodes: TreeNode[] = [];
  const dirs = new Set<string>();

  for (const file of files.sort()) {
    // /.env is the environment's own bookkeeping — real, but noise here.
    if (file.startsWith("/.env/")) continue;
    const stat = await desk.env.fs.stat(file);
    const name = file.split("/").pop() ?? file;
    nodes.push({
      path: file,
      name,
      kind: "file",
      size: stat?.size ?? 0,
      ext: (name.includes(".") ? name.split(".").pop() : "") ?? "",
    });
    // Record every ancestor so empty-looking branches still render.
    const parts = file.split("/").slice(1, -1);
    for (let i = 1; i <= parts.length; i++) dirs.add("/" + parts.slice(0, i).join("/"));
  }

  for (const dir of dirs) {
    if (dir.startsWith("/.env")) continue;
    nodes.push({ path: dir, name: dir.split("/").pop() ?? dir, kind: "dir", size: 0, ext: "" });
  }

  return Response.json({ nodes: nodes.sort((a, b) => a.path.localeCompare(b.path)) });
}
