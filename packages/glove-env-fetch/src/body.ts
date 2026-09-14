import type { EnvFsHandle } from "glove-working-environment";

export interface MultipartPart {
  name: string;
  value?: string;
  path?: string;
  filename?: string;
  contentType?: string;
}

export interface BodyOptions {
  body?: string;
  json?: unknown;
  bodyPath?: string;
  form?: Record<string, string | string[]>;
  multipart?: MultipartPart[];
}

export async function prepareBody(opts: BodyOptions, vfs: EnvFsHandle, headers: Headers, limit: number): Promise<Uint8Array | undefined> {
  const has = [opts.body, opts.json, opts.bodyPath, opts.form, opts.multipart].filter(value => value !== undefined).length;
  if (has > 1) throw new Error("Use only one of body, json, bodyPath, form or multipart");
  const bounded = (bytes: Uint8Array) => {
    if (bytes.length > limit) throw new Error("Request body exceeds the upload limit");
    return bytes;
  };
  const file = async (path: string) => {
    const stat = await vfs.stat(path);
    if (!stat || stat.kind !== "file") throw new Error("Request body path must identify an existing VFS file");
    if (stat.size > limit) throw new Error("Request body exceeds the upload limit");
    return bounded(await vfs.readBytes(path));
  };
  if (opts.bodyPath !== undefined) return file(opts.bodyPath);
  let text: string | undefined;
  if (opts.json !== undefined) {
    try { text = JSON.stringify(opts.json); } catch { throw new Error("Request JSON is not serializable"); }
    if (text === undefined) throw new Error("Request JSON is not serializable");
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
  } else if (opts.body !== undefined) {
    if (typeof opts.body !== "string") throw new TypeError("Request body must be a string; use bodyPath for a binary file");
    text = opts.body;
  } else if (opts.form !== undefined) {
    if (!opts.form || typeof opts.form !== "object" || Array.isArray(opts.form)) throw new Error("form must be a record of strings or string arrays");
    const form = new URLSearchParams();
    for (const [key, raw] of Object.entries(opts.form)) {
      for (const value of Array.isArray(raw) ? raw : [raw]) {
        if (typeof value !== "string") throw new Error("Form values must be strings");
        form.append(key, value);
      }
    }
    text = form.toString();
    if (!headers.has("content-type")) headers.set("content-type", "application/x-www-form-urlencoded");
  } else if (opts.multipart !== undefined) {
    if (!Array.isArray(opts.multipart)) throw new Error("multipart must be an array of named fields/files");
    if (headers.has("content-type")) throw new Error("Multipart Content-Type is generated automatically with its boundary");
    const form = new FormData();
    let size = 0;
    for (const part of opts.multipart) {
      if (!part || typeof part.name !== "string" || (part.path === undefined) === (part.value === undefined)) {
        throw new Error("Each multipart part needs a name and exactly one of value or path");
      }
      if (part.path !== undefined) {
        const data = await file(part.path);
        size += data.length;
        if (size > limit) throw new Error("Request body exceeds the upload limit");
        const filename = part.filename ?? part.path.split("/").pop()!;
        if (typeof filename !== "string" || (part.contentType !== undefined && typeof part.contentType !== "string")) throw new Error("Invalid multipart filename or content type");
        form.append(part.name, new Blob([new Uint8Array(data)], { type: part.contentType ?? "application/octet-stream" }), filename);
      } else {
        if (typeof part.value !== "string") throw new Error("Multipart field values must be strings");
        size += new TextEncoder().encode(part.value).length;
        if (size > limit) throw new Error("Request body exceeds the upload limit");
        form.append(part.name, part.value);
      }
    }
    // Let the platform generate/escape MIME headers, then bound the encoded
    // body including boundaries and metadata rather than only file sizes.
    const encoded = new Response(form);
    headers.set("content-type", encoded.headers.get("content-type")!);
    const reader = encoded.body!.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.length;
        if (bytes > limit) throw new Error("Request body exceeds the upload limit");
        chunks.push(part.value);
      }
    } finally { await reader.cancel(); reader.releaseLock(); }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
    return body;
  }
  return text === undefined ? undefined : bounded(new TextEncoder().encode(text));
}
