/** Download one file out of the environment, as bytes. */
import { peekDesk } from "@/lib/desk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  zip: "application/zip",
  csv: "text/csv",
  json: "application/json",
  md: "text/markdown",
  txt: "text/plain",
};

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const desk = peekDesk(url.searchParams.get("session") ?? "");
  const path = url.searchParams.get("path") ?? "";
  if (!desk || !path) return new Response("not found", { status: 404 });

  try {
    const bytes = await desk.env.fs.readBytes(path);
    const name = path.split("/").pop() ?? "file";
    const ext = (name.split(".").pop() ?? "").toLowerCase();
    return new Response(bytes as unknown as BodyInit, {
      headers: {
        "Content-Type": MIME[ext] ?? "application/octet-stream",
        "Content-Disposition": `attachment; filename="${name.replace(/"/g, "")}"`,
        "Content-Length": String(bytes.byteLength),
      },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
