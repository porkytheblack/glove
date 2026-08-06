/**
 * One media-type map, shared by the routes that serve bytes and the ones that
 * describe them.
 *
 * The environment already labels a *presented* file — `present` carries a
 * `mediaType` with it. This covers the other direction: any path in the tree,
 * picked in the file browser, where nobody has said what it is yet.
 */
const MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  zip: "application/zip",
  csv: "text/csv",
  json: "application/json",
  md: "text/markdown",
  txt: "text/plain",
};

/** Media type for a VFS path, from its extension. */
export function mediaTypeOf(path: string): string {
  const name = path.split("/").pop() ?? path;
  const ext = name.includes(".") ? (name.split(".").pop() ?? "").toLowerCase() : "";
  return MIME[ext] ?? "application/octet-stream";
}

/** Whether the browser can show this itself, given the bytes. */
export function playable(mediaType: string): boolean {
  return /^(image|video|audio)\//.test(mediaType);
}
