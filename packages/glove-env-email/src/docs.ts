/** Materialized at `/std/email/index.d.ts` and `/std/email/README.md`. */

export const EMAIL_TYPES = `/** env:email — .eml and Outlook .msg, opened inside the VFS. */

export interface EmailAddress {
  /** Display name, when the message carried one. */
  name?: string;
  address: string;
}

export interface AttachmentInfo {
  /** Filename as the message carried it. */
  name: string;
  bytes: number;
  contentType: string;
  /** True for an image shown inside the body rather than offered as a file. */
  inline: boolean;
}

export interface ExtractedAttachment extends AttachmentInfo {
  /** Where it was written. This is the path you hand to the other modules. */
  path: string;
  /** Content-ID, when the HTML body references this part as cid:... */
  contentId?: string;
}

export interface EmailSummary {
  path: string;
  format: "eml" | "msg";
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
  textCharacters: number;
  hasHtml: boolean;
}

export interface ExtractedEmail extends Omit<EmailSummary, "attachments"> {
  bcc: EmailAddress[];
  replyTo: EmailAddress[];
  /** The plain-text body. Empty for an HTML-only message. */
  text: string;
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
  /** Where attachments go. Default: <message path without extension>.attachments */
  dir?: string;
  /** Take only attachments whose filename matches this glob, e.g. "*.pdf". */
  include?: string;
  /** Include inline parts (images in an HTML signature). Default false. */
  inline?: boolean;
}

/**
 * Who sent it, what it says, what is attached — writing nothing.
 *
 * The format is worked out from the bytes, not the file name, so a message
 * exported as \`1.txt\` still opens.
 */
export function describe(path: string): Promise<EmailSummary>;

/**
 * The whole message, with every attachment written into the tree.
 *
 *   const mail = await extract('/inbox/thread.eml');
 *   for (const file of mail.attachments) {
 *     // file.path is an ordinary path — read it with any other module
 *   }
 *
 * Inline images are skipped unless you ask for them; \`include\` filters by
 * filename. Attachment names come from whoever sent the message, so they are
 * reduced to a safe basename and de-duplicated — read \`attachments[].path\`
 * rather than assuming the name you saw.
 */
export function extract(path: string, opts?: ExtractOptions): Promise<ExtractedEmail>;
`;

export const EMAIL_DOCS = `# env:email

\`.eml\` and Outlook \`.msg\`, opened in place. The point is the attachments:
they land in the tree as ordinary files, so everything else can read them.

## The thing you actually want

\`\`\`js
import { extract } from 'env:email';
import { pdf } from 'env:documents';

/** Summarises whatever PDF came attached to a message. */
export default async function main() {
  const mail = await extract('/inbox/thread.eml', { include: '*.pdf' });
  if (mail.attachments.length === 0) return { subject: mail.subject, note: mail.note ?? 'no PDF attached' };

  const doc = await pdf.extractText(mail.attachments[0].path);
  return { subject: mail.subject, from: mail.from?.address, text: doc.text.slice(0, 2000) };
}
\`\`\`

\`attachments[].path\` is a normal path. \`env:documents\`, \`env:images\`,
\`env:spreadsheets\`, \`env:archives\` and \`env:ocr\` all take it as-is — an
email is an envelope, and once it is open nothing downstream needs to know.

## Look before you extract

\`\`\`js
import { describe } from 'env:email';

export default async function main() {
  const mail = await describe('/inbox/thread.eml');
  return {
    subject: mail.subject,
    from: mail.from,
    when: mail.date,
    attached: mail.attachments.map(a => \`\${a.name} (\${a.bytes} bytes, \${a.contentType})\`),
  };
}
\`\`\`

\`describe\` writes nothing, so it is the call to make when you are deciding
whether a message is worth opening — or which of thirty in a directory is.

## A scanned attachment

The common shape, end to end:

\`\`\`js
import { extract } from 'env:email';
import { recognize } from 'env:ocr';

export default async function main() {
  const mail = await extract('/inbox/receipt.msg', { include: '*.pdf' });
  const read = await recognize(mail.attachments[0].path);
  return { subject: mail.subject, text: read.text, confidence: read.confidence };
}
\`\`\`

## Filenames are the sender's, not yours

An attachment filename is chosen by whoever sent the message, and
\`../../etc/passwd\` is a legal one. Names are reduced to a bare filename,
stripped of control characters, and de-duplicated (\`report.pdf\`,
\`report-2.pdf\`) — so **use \`attachments[].path\`**, not the name you expected.

Inline images — the logo in a signature, anything the HTML body references as
\`cid:…\` — are skipped by default. They are almost never what you want and a
long signature can carry a dozen. Pass \`{ inline: true }\` when they are.

## Formats

| Format | Read | Notes |
|---|---|---|
| \`.eml\` | ✅ | RFC 5322, MIME, encoded words, nested multiparts |
| \`.msg\` | ✅ | Outlook OLE compound file; embedded messages are reported, not extracted |
| \`.mbox\` | refused | a mailbox is many messages; the refusal says how many |

Nothing is written back: this module reads messages, it does not compose them.
`;
