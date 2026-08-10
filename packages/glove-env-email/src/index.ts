/**
 * `env:email` — an inbox is where the complicated files come from.
 *
 * Before this, an attached `.eml` was a wall. No adapter claimed it, so `ls`
 * called it bytes, `describe` had nowhere to route it, and the PDF inside it —
 * the thing the user was actually asking about — was unreachable. The whole
 * point of the rest of the environment is opening awkward artifacts, and the
 * commonest envelope they arrive in could not be opened at all.
 *
 * So the job here is small and specific: **turn one message into the files it
 * contains.** Headers and body come back as data; every attachment is written
 * into the tree as a real file, at a real path, where `env:documents`,
 * `env:images`, `env:archives` and `env:ocr` can pick it up. `extract` returns
 * those paths; nothing else in the environment needs to know an email was
 * involved.
 *
 * Two formats, because both actually turn up:
 *
 * - `.eml` — RFC 5322 text, parsed with `mailparser`;
 * - `.msg` — Outlook's OLE compound file, parsed with `@kenjiuno/msgreader`.
 *
 * And recognition is by **content**, not by name. Messages arrive from export
 * tools called `message`, `1.txt`, `forward.eml.txt`; the bytes say what they
 * are and the extension only breaks ties.
 *
 * **Filenames from a message are hostile input.** They are chosen by whoever
 * sent the mail, and `../../etc/passwd` is a legal MIME filename. Every one is
 * reduced to a bare name and resolved against the destination, and anything
 * that still escapes is refused — same rule, and same reason, as `env:archives`.
 */
import { defineAdapter, globToRegExp, type EnvFsHandle } from "glove-working-environment";
import { countMboxMessages, detect, parseEml, parseMsg, type EmailAddress, type ParsedMessage } from "./parse";
import { EMAIL_DOCS, EMAIL_TYPES } from "./docs";

export type { EmailAddress };

export interface AttachmentInfo {
  /** Filename as the message carried it. */
  name: string;
  bytes: number;
  contentType: string;
  /** True for a part shown inside the body (an inline image) rather than offered as a file. */
  inline: boolean;
}

export interface ExtractedAttachment extends AttachmentInfo {
  /** Where it was written. This is the path to hand to the other adapters. */
  path: string;
  /** Content-ID, when the HTML body references this part as `cid:…`. */
  contentId?: string;
}

export interface EmailSummary {
  path: string;
  format: "eml" | "msg";
  /** Size of the message file itself. */
  bytes: number;
  subject: string;
  from?: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  /** ISO 8601, when the message carried a parseable date. */
  date?: string;
  messageId?: string;
  /** What is attached — named and sized, but not written anywhere yet. */
  attachments: AttachmentInfo[];
  /** Characters in the plain-text body. */
  textCharacters: number;
  hasHtml: boolean;
}

export interface ExtractedEmail extends Omit<EmailSummary, "attachments"> {
  bcc: EmailAddress[];
  replyTo: EmailAddress[];
  /** The plain-text body. Empty for an HTML-only message with no text part. */
  text: string;
  /** The HTML body, when there is one. */
  html?: string;
  /** Header name (lowercased) to value. */
  headers: Record<string, string>;
  /** Every attachment written out, with the path it now lives at. */
  attachments: ExtractedAttachment[];
  /** Where the attachments were written. */
  dir: string;
  /** Present when something could not be represented — an embedded message, a skipped part. */
  note?: string;
}

export interface ExtractOptions {
  /** Where attachments go. Default: `<message path without extension>.attachments`. */
  dir?: string;
  /** Take only attachments whose filename matches this glob, e.g. `"*.pdf"`. */
  include?: string;
  /** Include inline parts (the images in an HTML signature). Default false. */
  inline?: boolean;
}

export interface EmailAdapterOptions {
  /** Most attachments one message may yield. Default 200. */
  maxAttachments?: number;
}

const DEFAULT_MAX_ATTACHMENTS = 200;

/**
 * Reduce a filename from a message to something safe to write.
 *
 * The rules, in the order they matter:
 *
 * 1. **Only the basename survives.** A MIME filename is a name, not a path;
 *    `../../etc/passwd` and `C:\windows\x` are both just `passwd` and `x`. This
 *    single step removes traversal entirely rather than trying to detect it.
 * 2. Control characters and the separators themselves are replaced, because a
 *    NUL or a newline in a path is a different class of bug.
 * 3. `.` and `..` as whole names, and the empty name, become a placeholder —
 *    they are not filenames, and writing them would mean writing the directory.
 */
export function safeName(raw: string, fallback: string): string {
  const basename = raw.replace(/\\/g, "/").split("/").pop() ?? "";
  const cleaned = basename
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/^\s+|\s+$/g, "")
    .replace(/^\.+$/, "");
  if (cleaned === "") return fallback;
  // 200 leaves room for a "-2" disambiguator inside any sane path limit.
  return cleaned.length > 200 ? cleaned.slice(0, 200) : cleaned;
}

/** `report.pdf` taken twice becomes `report.pdf` and `report-2.pdf`. */
function unique(name: string, taken: Set<string>): string {
  if (!taken.has(name)) {
    taken.add(name);
    return name;
  }
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

function matcher(pattern: string | undefined): (name: string) => boolean {
  if (!pattern) return () => true;
  // Borrowed from the core rather than re-derived, so `**/*.pdf` and `*.pdf`
  // mean here exactly what they mean in `glob` and in `env:archives`.
  const re = globToRegExp(pattern.startsWith("/") ? pattern : `/${pattern}`);
  return (name) => re.test(`/${name}`);
}

function stem(path: string): string {
  const base = path.split("/").pop() || path;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

function parentOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut <= 0 ? "" : path.slice(0, cut);
}

function toInfo(message: ParsedMessage): AttachmentInfo[] {
  return message.attachments.map((a) => ({
    name: a.name,
    bytes: a.bytes.byteLength,
    contentType: a.contentType,
    inline: a.inline,
  }));
}

export function email(options: EmailAdapterOptions = {}) {
  const maxAttachments = Math.max(1, options.maxAttachments ?? DEFAULT_MAX_ATTACHMENTS);

  return defineAdapter({
    name: "email",
    description:
      "Open .eml and Outlook .msg messages: headers, body, and attachments written into the tree so the other adapters can read them.",
    types: EMAIL_TYPES,
    docs: EMAIL_DOCS,
    handles: {
      // `.mbox` is claimed on purpose even though it is refused: routing it
      // here produces "this is a mailbox of N messages, split it" instead of
      // leaving it an unexplained binary.
      extensions: [".eml", ".msg", ".mbox"],
      // Deliberately no magic: a `.msg` is an OLE compound file, and so are
      // legacy `.doc`, `.xls` and `.ppt`. Claiming `D0CF11E0` would win the
      // `describe` dispatch for all of them — magic beats extension across
      // every adapter — and answer "this is not a readable message" for files
      // another module handles properly. Content detection still happens
      // inside describe(); it just does not hijack routing.
    },
    create(vfs: EnvFsHandle) {
      const load = async (path: string): Promise<{ message: ParsedMessage; bytes: number }> => {
        if (typeof path !== "string") throw new Error("email takes a path");
        const stat = await vfs.stat(path);
        if (!stat) throw new Error(`no such file: ${path}`);
        if (stat.kind !== "file") throw new Error(`${path} is a directory`);
        const raw = await vfs.readBytes(path);
        const format = detect(raw, path);
        if (!format) {
          throw new Error(
            `${path} is not an email message — it is neither an RFC 5322 header block (.eml) nor an ` +
              `OLE compound file (.msg). If this came out of an export tool, check you have the message ` +
              `itself and not a listing or an index.`,
          );
        }
        if (format === "mbox") {
          // Parsing this would return the first message and silently drop the
          // rest — the failure mode that looks exactly like success.
          throw new Error(
            `${path} is an mbox holding ${countMboxMessages(raw)} messages, not a single message. ` +
              `env:email reads one message at a time; split the mailbox into .eml files first, ` +
              `or point it at the message you want.`,
          );
        }
        const message = format === "msg" ? await parseMsg(raw) : await parseEml(raw);
        if (message.attachments.length > maxAttachments) {
          throw new Error(
            `this message declares ${message.attachments.length} attachments, over the ${maxAttachments} cap — ` +
              `refusing to write them all. Raise maxAttachments if this is genuinely one message.`,
          );
        }
        return { message, bytes: stat.size };
      };

      return {
        /**
         * Who sent it, what it says, and what is attached — without writing
         * anything. The cheap call to make before deciding what to extract.
         */
        async describe(path: string): Promise<EmailSummary> {
          const { message, bytes } = await load(path);
          return {
            path,
            format: message.format,
            bytes,
            subject: message.subject,
            ...(message.from ? { from: message.from } : {}),
            to: message.to,
            cc: message.cc,
            ...(message.date ? { date: message.date } : {}),
            ...(message.messageId ? { messageId: message.messageId } : {}),
            attachments: toInfo(message),
            textCharacters: message.text.length,
            hasHtml: message.html !== undefined,
          };
        },

        /**
         * The whole message, with every attachment written into the tree.
         *
         * The returned `attachments[].path` values are ordinary VFS paths —
         * hand them straight to `documents.extractText`, `images.describe`,
         * `archives.extract` or `ocr.recognize`.
         */
        async extract(path: string, opts: ExtractOptions = {}): Promise<ExtractedEmail> {
          const { message, bytes } = await load(path);
          const dir = (opts.dir ?? `${parentOf(path)}/${stem(path)}.attachments`).replace(/\/+$/, "");
          const wanted = matcher(opts.include);
          const includeInline = opts.inline ?? false;

          const taken = new Set<string>();
          const written: ExtractedAttachment[] = [];
          let skippedInline = 0;
          for (const [index, attachment] of message.attachments.entries()) {
            if (attachment.inline && !includeInline) {
              skippedInline++;
              continue;
            }
            const name = unique(safeName(attachment.name, `attachment-${index + 1}`), taken);
            if (!wanted(name)) continue;
            const target = `${dir}/${name}`;
            // The name is already a basename, so this cannot escape — the
            // assertion is here because "cannot" is a claim, and a claim about
            // a path written from hostile input is worth checking.
            if (!target.startsWith(`${dir}/`) || target.includes("/../")) {
              throw new Error(`refusing attachment ${JSON.stringify(attachment.name)}: it does not stay inside ${dir}`);
            }
            await vfs.writeFile(target, attachment.bytes);
            written.push({
              name,
              path: target,
              bytes: attachment.bytes.byteLength,
              contentType: attachment.contentType,
              inline: attachment.inline,
              ...(attachment.contentId ? { contentId: attachment.contentId } : {}),
            });
          }

          const notes = [...message.warnings];
          if (skippedInline > 0) {
            notes.push(
              `${skippedInline} inline part(s) — images embedded in the body — were not written. ` +
                `Pass { inline: true } if you need them.`,
            );
          }
          if (opts.include && written.length === 0 && message.attachments.length > 0) {
            notes.push(
              `nothing matched ${JSON.stringify(opts.include)}; the message carries ` +
                `${message.attachments.map((a) => a.name).join(", ")}.`,
            );
          }

          return {
            path,
            format: message.format,
            bytes,
            subject: message.subject,
            ...(message.from ? { from: message.from } : {}),
            to: message.to,
            cc: message.cc,
            bcc: message.bcc,
            replyTo: message.replyTo,
            ...(message.date ? { date: message.date } : {}),
            ...(message.messageId ? { messageId: message.messageId } : {}),
            text: message.text,
            ...(message.html !== undefined ? { html: message.html } : {}),
            headers: message.headers,
            attachments: written,
            dir,
            textCharacters: message.text.length,
            hasHtml: message.html !== undefined,
            ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
          };
        },
      };
    },
  });
}

export default email;
