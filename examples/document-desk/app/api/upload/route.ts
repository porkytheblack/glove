/**
 * Uploads land in /inbox — the convention the system prompt tells the model about.
 *
 * Anything is accepted. The environment is a filesystem, not a format
 * allowlist: an adapter may not understand a `.heic`, but the agent can still
 * describe it, convert it, or hand it to something that does. Refusing at the
 * door would only mean refusing files that turn out to be usable.
 *
 * Every file is reported individually. One bad file used to fail the whole
 * request, which threw away the result for the good ones already written — the
 * caller could not tell what had landed and what had not.
 */
import { getDesk } from "@/lib/desk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface UploadResult {
  /** `original` is the picked name; `name` is what it landed as after any
   *  collision rename, and the two are reported separately so a caller can
   *  match its own pending list without guessing at the rename rule. */
  files: Array<{ path: string; name: string; original: string; bytes: number }>;
  errors: Array<{ name: string; error: string }>;
}

/**
 * A free path for this upload.
 *
 * Uploading `chart.png` twice should not destroy the first one — the agent may
 * already have referenced it, and a silent overwrite is the kind of data loss
 * nobody reports because nobody sees it.
 */
async function freePath(exists: (path: string) => Promise<boolean>, name: string): Promise<string> {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  if (!(await exists(`/inbox/${name}`))) return `/inbox/${name}`;
  for (let n = 2; n < 1000; n++) {
    const candidate = `/inbox/${stem}-${n}${ext}`;
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error(`too many files already named ${name}`);
}

export async function POST(req: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch (e) {
    // A body too large for the platform, or a malformed multipart stream.
    return Response.json(
      { files: [], errors: [{ name: "upload", error: e instanceof Error ? e.message : String(e) }] },
      { status: 400 },
    );
  }

  const sessionId = String(form.get("sessionId") ?? "");
  if (!sessionId) return Response.json({ error: "sessionId is required" }, { status: 400 });

  const desk = await getDesk(sessionId);
  const exists = async (path: string) => (await desk.env.fs.stat(path)) !== null;

  const result: UploadResult = { files: [], errors: [] };

  for (const entry of form.getAll("files")) {
    if (!(entry instanceof File)) continue;
    // Strip any path the browser attached — an upload names a file, not a
    // location, and `../` in a filename is not this app's problem to inherit.
    const name = entry.name.split(/[/\\]/).pop() || "upload";
    try {
      const bytes = new Uint8Array(await entry.arrayBuffer());
      const path = await freePath(exists, name);
      await desk.env.mount(bytes, path);
      result.files.push({ path, name: path.split("/").pop()!, original: name, bytes: bytes.byteLength });
    } catch (e) {
      result.errors.push({ name, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // 200 even with errors in it: the per-file record is the answer, and a status
  // code cannot express "three landed, one was too big".
  return Response.json(result);
}
