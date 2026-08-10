/**
 * The two parsers behind `env:email`, normalised to one shape.
 *
 * `.eml` is RFC 5322 text and goes through `mailparser`. `.msg` is an OLE
 * compound file — an entirely different container with Outlook's own property
 * tags inside — and goes through `@kenjiuno/msgreader`. Nothing above this
 * file needs to know which, because a caller asking "who sent this and what
 * was attached" is asking the same question either way.
 *
 * Everything here is host-side and pure: bytes in, a parsed message out. It
 * writes nothing; the adapter decides where attachments land.
 */

export interface EmailAddress {
  /** Display name, when the message carried one. */
  name?: string;
  address: string;
}

export interface ParsedAttachment {
  /** The filename as sent, before any sanitising. */
  name: string;
  contentType: string;
  bytes: Uint8Array;
  /** Content-ID, for a part referenced from the HTML body as `cid:…`. */
  contentId?: string;
  /** True for a part the message displays inline rather than offering as a file. */
  inline: boolean;
}

export interface ParsedMessage {
  format: "eml" | "msg";
  subject: string;
  from?: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  replyTo: EmailAddress[];
  /** ISO 8601, when the message carried a parseable date. */
  date?: string;
  messageId?: string;
  text: string;
  html?: string;
  /** Header name (lowercased) to value, for the headers that were present. */
  headers: Record<string, string>;
  attachments: ParsedAttachment[];
  /**
   * Set when something in the message could not be represented — an embedded
   * `.msg`, most often. Surfaced rather than dropped.
   */
  warnings: string[];
}

/** OLE compound file (`.msg`, and also legacy `.doc`/`.xls`). */
const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/**
 * What is this, going by the bytes?
 *
 * The extension is the last resort, not the first: mail arrives out of export
 * tools with names like `message`, `1.txt` and `forward.eml.txt`, and an
 * adapter that trusted the suffix would refuse half of them.
 *
 * An `.eml` has no magic number, so recognition is structural: near the top
 * there must be a line that looks like an RFC 5322 header, and at least one of
 * them has to be a header a message actually has to carry.
 */
export function detect(bytes: Uint8Array, path: string): "eml" | "msg" | "mbox" | null {
  if (CFB_MAGIC.every((b, i) => bytes[i] === b)) return "msg";
  if (looksLikeRfc822(bytes)) return countMboxMessages(bytes) > 1 ? "mbox" : "eml";
  const lower = path.toLowerCase();
  if (lower.endsWith(".msg")) return "msg";
  if (lower.endsWith(".eml")) return "eml";
  if (lower.endsWith(".mbox")) return "mbox";
  return null;
}

/**
 * How many messages an mbox holds — 1 for an ordinary single message.
 *
 * This exists so a mailbox is never mistaken for a message. `simpleParser`
 * would happily parse an mbox of four hundred messages and return the first
 * one, with nothing anywhere saying the other 399 were dropped. That is the
 * exact shape of silent wrong answer worth spending code to avoid.
 *
 * The separator is a line starting `From ` at the very beginning of a line.
 * Real mboxes escape a body line that would look like one as `>From `, so
 * this counts only the unescaped form.
 */
export function countMboxMessages(bytes: Uint8Array): number {
  const text = Buffer.from(bytes).toString("latin1");
  let count = 0;
  if (/^From \S+/.test(text)) count++;
  for (const _ of text.matchAll(/\n\r?\nFrom \S+ /g)) count++;
  return Math.max(count, 1);
}

/** Headers that make a blob of text a message rather than a text file. */
const DECISIVE = /^(from|to|subject|date|message-id|received|return-path|delivered-to|mime-version)$/i;
const HEADER_LINE = /^([!-9;-~]+):\s?(.*)$/;

function looksLikeRfc822(bytes: Uint8Array): boolean {
  // Headers are ASCII by definition; 8k is far more than any header block
  // needs and keeps this cheap on a large attachment-heavy message.
  const head = Buffer.from(bytes.subarray(0, 8192)).toString("latin1");
  // Some exports keep the mbox `From ` separator line; it is not a header but
  // it is a strong signal, and skipping it lets the real ones be seen.
  const lines = head.split(/\r?\n/);
  let sawHeader = false;
  for (const line of lines) {
    if (line === "") break; // end of the header block
    if (/^From \S+/.test(line)) continue;
    if (/^[ \t]/.test(line)) continue; // folded continuation
    const m = HEADER_LINE.exec(line);
    if (!m) return false; // a non-header line inside the block: not a message
    if (DECISIVE.test(m[1])) sawHeader = true;
  }
  return sawHeader;
}

// ------------------------------------------------------------------- .eml

interface MailparserAddress {
  value?: Array<{ name?: string; address?: string }>;
}

export async function parseEml(bytes: Uint8Array): Promise<ParsedMessage> {
  const { simpleParser } = await import("mailparser");
  const parsed = await simpleParser(Buffer.from(bytes));

  const headers: Record<string, string> = {};
  for (const [key, value] of parsed.headers) {
    headers[key] = headerToString(value);
  }

  const attachments: ParsedAttachment[] = parsed.attachments.map((a) => ({
    name: a.filename ?? "",
    contentType: a.contentType || "application/octet-stream",
    bytes: new Uint8Array(a.content),
    ...(a.cid ? { contentId: a.cid } : {}),
    // mailparser reports `contentDisposition`; a part with a Content-ID and no
    // explicit attachment disposition is an inline image, which is the case
    // that matters — those should not be presented as documents to read.
    inline: a.contentDisposition === "inline" || (!!a.cid && a.contentDisposition !== "attachment"),
  }));

  return {
    format: "eml",
    subject: parsed.subject ?? "",
    ...(addresses(parsed.from as MailparserAddress)[0] ? { from: addresses(parsed.from as MailparserAddress)[0] } : {}),
    to: addresses(parsed.to as MailparserAddress),
    cc: addresses(parsed.cc as MailparserAddress),
    bcc: addresses(parsed.bcc as MailparserAddress),
    replyTo: addresses(parsed.replyTo as MailparserAddress),
    ...(parsed.date ? { date: parsed.date.toISOString() } : {}),
    ...(parsed.messageId ? { messageId: parsed.messageId } : {}),
    text: (parsed.text ?? "").trim(),
    ...(typeof parsed.html === "string" && parsed.html !== "" ? { html: parsed.html } : {}),
    headers,
    attachments,
    warnings: [],
  };
}

function addresses(field: MailparserAddress | undefined): EmailAddress[] {
  const out: EmailAddress[] = [];
  for (const entry of field?.value ?? []) {
    if (!entry.address) continue;
    out.push(entry.name ? { name: entry.name, address: entry.address } : { address: entry.address });
  }
  return out;
}

function headerToString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(headerToString).join(", ");
  if (value && typeof value === "object") {
    const v = value as { text?: string; value?: unknown };
    if (typeof v.text === "string") return v.text;
    if (v.value !== undefined) return headerToString(v.value);
  }
  return String(value ?? "");
}

// ------------------------------------------------------------------- .msg

interface MsgAttachment {
  fileName?: string;
  attachMimeTag?: string;
  pidContentId?: string;
  attachmentHidden?: boolean;
  innerMsgContent?: true;
  name?: string;
}

interface MsgFields {
  subject?: string;
  body?: string;
  bodyHtml?: string;
  senderName?: string;
  senderEmail?: string;
  headers?: string;
  clientSubmitTime?: string;
  messageDeliveryTime?: string;
  messageId?: string;
  recipients?: Array<{ name?: string; email?: string; smtpAddress?: string; recipType?: string }>;
  attachments?: MsgAttachment[];
}

export async function parseMsg(bytes: Uint8Array): Promise<ParsedMessage> {
  const namespace = (await import("@kenjiuno/msgreader")) as unknown as Record<string, unknown>;
  const MsgReader = resolveMsgReader(namespace);

  // msgreader wants an ArrayBuffer that starts at the message; a Uint8Array
  // view into a larger buffer would be read from the wrong offset.
  const copy = bytes.slice();
  const reader = new MsgReader(copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength));
  const data = reader.getFileData() as MsgFields & { error?: string };
  if (data.error) {
    throw new Error(`this is not a readable Outlook .msg: ${data.error}`);
  }

  const warnings: string[] = [];
  const attachments: ParsedAttachment[] = [];
  for (const [index, meta] of (data.attachments ?? []).entries()) {
    if (meta.innerMsgContent) {
      // An embedded message is a whole second message, not a file. Rather
      // than write a fabricated `.msg` we could not guarantee is loadable, we
      // say what was skipped and why.
      warnings.push(
        `attachment ${index + 1} (${meta.name || meta.fileName || "unnamed"}) is an embedded message, not a file — ` +
          `it was not extracted. Outlook can save it as its own .msg.`,
      );
      continue;
    }
    const content = reader.getAttachment(index) as { fileName?: string; content: Uint8Array };
    attachments.push({
      name: content.fileName || meta.fileName || meta.name || "",
      contentType: meta.attachMimeTag || "application/octet-stream",
      bytes: new Uint8Array(content.content),
      ...(meta.pidContentId ? { contentId: meta.pidContentId } : {}),
      inline: meta.attachmentHidden === true || !!meta.pidContentId,
    });
  }

  const to: EmailAddress[] = [];
  const cc: EmailAddress[] = [];
  const bcc: EmailAddress[] = [];
  for (const r of data.recipients ?? []) {
    const address = r.smtpAddress || r.email;
    if (!address) continue;
    const entry: EmailAddress = r.name ? { name: r.name, address } : { address };
    const bucket = r.recipType === "cc" ? cc : r.recipType === "bcc" ? bcc : to;
    bucket.push(entry);
  }

  const when = data.clientSubmitTime || data.messageDeliveryTime;
  const parsedDate = when ? new Date(when) : undefined;

  return {
    format: "msg",
    subject: data.subject ?? "",
    ...(data.senderEmail
      ? { from: data.senderName ? { name: data.senderName, address: data.senderEmail } : { address: data.senderEmail } }
      : {}),
    to,
    cc,
    bcc,
    replyTo: [],
    ...(parsedDate && !Number.isNaN(parsedDate.getTime()) ? { date: parsedDate.toISOString() } : {}),
    ...(data.messageId ? { messageId: data.messageId } : {}),
    text: (data.body ?? "").trim(),
    ...(data.bodyHtml ? { html: data.bodyHtml } : {}),
    // A .msg keeps the original transport headers in one blob when it has them
    // at all; parse it back into the same map shape .eml produces.
    headers: data.headers ? parseHeaderBlock(data.headers) : {},
    attachments,
    warnings,
  };
}

type MsgReaderCtor = new (buffer: ArrayBuffer) => {
  getFileData(): unknown;
  getAttachment(index: number): unknown;
};

/**
 * msgreader is CJS with a `default` export, which ESM interop presents in two
 * different shapes depending on how it was loaded. Pick whichever is the
 * constructor instead of guessing and crashing at the first `.msg`.
 */
function resolveMsgReader(namespace: Record<string, unknown>): MsgReaderCtor {
  const direct = namespace.default;
  if (typeof direct === "function") return direct as MsgReaderCtor;
  const nested = (direct as Record<string, unknown> | undefined)?.default;
  if (typeof nested === "function") return nested as MsgReaderCtor;
  throw new Error("@kenjiuno/msgreader did not export a reader — the package layout changed");
}

function parseHeaderBlock(block: string): Record<string, string> {
  const headers: Record<string, string> = {};
  // Unfold first: a header may continue onto following lines that begin with
  // whitespace, and splitting naively would drop the continuation.
  for (const line of block.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const m = HEADER_LINE.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    headers[key] = headers[key] ? `${headers[key]}, ${m[2]}` : m[2];
  }
  return headers;
}
