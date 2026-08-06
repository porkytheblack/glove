/** Serve one file out of the environment, as bytes — to download or to play. */
import { peekDesk } from "@/lib/desk";
import { mediaTypeOf, playable } from "@/lib/mime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const desk = peekDesk(url.searchParams.get("session") ?? "");
  const path = url.searchParams.get("path") ?? "";
  if (!desk || !path) return new Response("not found", { status: 404 });

  try {
    const bytes = await desk.env.fs.readBytes(path);
    const name = path.split("/").pop() ?? "file";
    const type = mediaTypeOf(path);
    // Media the page can show gets `inline`, so a <video> or <img> pointed at
    // this URL renders instead of downloading. The download buttons carry the
    // anchor's `download` attribute, which wins over the header on a
    // same-origin link — so both behaviours come off the one route.
    return new Response(bytes as unknown as BodyInit, {
      headers: {
        "Content-Type": type,
        "Content-Disposition": `${playable(type) ? "inline" : "attachment"}; filename="${name.replace(/"/g, "")}"`,
        "Content-Length": String(bytes.byteLength),
      },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
