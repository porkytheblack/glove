/** Uploads land in /inbox — the convention the system prompt tells the model about. */
import { getDesk } from "@/lib/desk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const form = await req.formData();
  const sessionId = String(form.get("sessionId") ?? "");
  if (!sessionId) return Response.json({ error: "sessionId is required" }, { status: 400 });

  const desk = await getDesk(sessionId);
  const written: Array<{ path: string; bytes: number }> = [];

  for (const entry of form.getAll("files")) {
    if (!(entry instanceof File)) continue;
    // Strip any path the browser attached — an upload names a file, not a
    // location, and `../` in a filename is not this app's problem to inherit.
    const name = entry.name.split(/[/\\]/).pop() || "upload";
    const bytes = new Uint8Array(await entry.arrayBuffer());
    try {
      await desk.env.mount(bytes, `/inbox/${name}`);
      written.push({ path: `/inbox/${name}`, bytes: bytes.byteLength });
    } catch (e) {
      return Response.json(
        { error: `${name}: ${e instanceof Error ? e.message : String(e)}` },
        { status: 400 },
      );
    }
  }

  return Response.json({ files: written });
}
