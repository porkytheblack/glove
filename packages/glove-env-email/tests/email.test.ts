/**
 * The email adapter, exercised the way a script reaches it — through the realm
 * bridge, against the guarded VFS.
 *
 * Two things are worth more than the rest and get the attention:
 *
 * **Attachment bytes must survive exactly.** The whole reason this adapter
 * exists is that the PDF inside a message should reach `env:documents`
 * unaltered. A test that checks a file appeared would pass against a base64
 * decoder that dropped its last block, so every attachment assertion here
 * compares the bytes that went in to the bytes that came out.
 *
 * **Attachment filenames are hostile input.** They are chosen by whoever sent
 * the message, and `../../etc/passwd` is a legal MIME filename.
 *
 * The `.msg` fixtures are real OLE compound files, written by `@tutao/oxmsg`
 * and read back by the adapter's own parser — a genuine round trip through the
 * format, not a hand-waved mock.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Attachment, Email as OxEmail } from "@tutao/oxmsg";
import { createAdapterTestEnv, assertAdapterOk } from "glove-working-environment/testing";
import { email, safeName, type EmailSummary, type ExtractedEmail } from "../src/index";

const env = () => createAdapterTestEnv(email());
const utf8 = (s: string) => new TextEncoder().encode(s);

/** A tiny but genuine PDF, so an attachment assertion is about real bytes. */
const PDF_BYTES = utf8("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
const CSV_BYTES = utf8("region,amount\nnorth,1200\nsouth,830\n");

interface EmlPart {
  headers: string[];
  body: string;
}

/**
 * Build a `.eml` by hand.
 *
 * Deliberately not with a mail library: the fixture is the input under test,
 * and generating it with the same kind of code that parses it would let a
 * shared misunderstanding pass unnoticed. These are the bytes a mail server
 * would hand over, CRLF line endings and all.
 */
function buildEml(opts: {
  headers?: string[];
  text?: string;
  html?: string;
  attachments?: Array<{ name: string; type: string; bytes: Uint8Array; inline?: boolean; cid?: string }>;
}): Uint8Array {
  const boundary = "MIXEDBOUNDARY";
  const alt = "ALTBOUNDARY";
  const parts: EmlPart[] = [];

  if (opts.html !== undefined) {
    // text/plain and text/html as alternatives of each other, nested inside
    // the mixed part — which is what a real client sends.
    const inner = [
      `--${alt}`,
      'Content-Type: text/plain; charset="utf-8"',
      "",
      opts.text ?? "",
      `--${alt}`,
      'Content-Type: text/html; charset="utf-8"',
      "",
      opts.html,
      `--${alt}--`,
      "",
    ].join("\r\n");
    parts.push({ headers: [`Content-Type: multipart/alternative; boundary="${alt}"`], body: inner });
  } else {
    parts.push({ headers: ['Content-Type: text/plain; charset="utf-8"'], body: opts.text ?? "" });
  }

  for (const a of opts.attachments ?? []) {
    parts.push({
      headers: [
        `Content-Type: ${a.type}; name="${a.name}"`,
        `Content-Disposition: ${a.inline ? "inline" : "attachment"}; filename="${a.name}"`,
        ...(a.cid ? [`Content-ID: <${a.cid}>`] : []),
        "Content-Transfer-Encoding: base64",
      ],
      body: (Buffer.from(a.bytes).toString("base64").match(/.{1,76}/g) ?? []).join("\r\n"),
    });
  }

  const lines = [
    ...(opts.headers ?? [
      "From: Dana Ruiz <dana@acme.example>",
      "To: ops@carrier.example",
      "Subject: Test message",
      "Date: Tue, 12 Mar 2024 09:14:00 +0100",
    ]),
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
  ];
  for (const part of parts) {
    lines.push(`--${boundary}`, ...part.headers, "", part.body);
  }
  lines.push(`--${boundary}--`, "");
  return utf8(lines.join("\r\n"));
}

/** A real Outlook `.msg`: an OLE compound file, written field by field. */
function buildMsg(opts: {
  subject: string;
  text: string;
  attachments?: Array<{ name: string; bytes: Uint8Array }>;
}): Uint8Array {
  let message = new OxEmail(false, false)
    .subject(opts.subject)
    .bodyText(opts.text)
    .sender("dana@acme.example", "Dana Ruiz")
    .to("ops@carrier.example", "Ops")
    .cc("audit@acme.example", "Audit")
    .sentOn(new Date("2024-03-12T08:14:00Z"));
  for (const a of opts.attachments ?? []) {
    message = message.attach(new Attachment(a.bytes, a.name));
  }
  return message.msg();
}

test("the adapter's bindings and types agree", async () => {
  const t = await env();
  assertAdapterOk(await t.audit());
});

// ================================================= headers, body, addresses

test("an .eml gives up its headers, both bodies and its addresses", async () => {
  const t = await env();
  await t.fs.writeFile(
    "/inbox/thread.eml",
    buildEml({
      headers: [
        "From: Dana Ruiz <dana@acme.example>",
        "To: ops@carrier.example, Billing <billing@carrier.example>",
        "Cc: audit@acme.example",
        // An RFC 2047 encoded word: a subject with a non-ASCII character in it
        // arrives base64'd, and a parser that skipped the decoding would hand
        // the model gibberish that still looks like a subject.
        "Subject: =?utf-8?B?SW52b2ljZSDigJQgTWFyY2g=?=",
        "Date: Tue, 12 Mar 2024 09:14:00 +0100",
        "Message-ID: <abc123@acme.example>",
      ],
      text: "Please find the invoice attached. Total 3775.20 EUR.",
      html: "<p>Please find the invoice <b>attached</b>.</p>",
    }),
  );

  const mail = await t.script<ExtractedEmail>(
    `import { extract } from 'env:email';
     export default async function main() { return extract('/inbox/thread.eml'); }`,
  );

  assert.equal(mail.format, "eml");
  assert.equal(mail.subject, "Invoice — March", "the encoded-word subject was not decoded");
  assert.deepEqual(mail.from, { name: "Dana Ruiz", address: "dana@acme.example" });
  assert.deepEqual(
    mail.to.map((a) => a.address),
    ["ops@carrier.example", "billing@carrier.example"],
  );
  assert.deepEqual(mail.cc.map((a) => a.address), ["audit@acme.example"]);
  assert.equal(mail.date, "2024-03-12T08:14:00.000Z");
  assert.equal(mail.messageId, "<abc123@acme.example>");
  assert.match(mail.text, /Total 3775\.20 EUR/);
  assert.match(String(mail.html), /<b>attached<\/b>/);
  assert.equal(mail.hasHtml, true);
  assert.equal(mail.headers["message-id"], "<abc123@acme.example>");
});

test("describe answers the same questions without writing anything", async () => {
  const t = await env();
  await t.fs.writeFile(
    "/inbox/thread.eml",
    buildEml({
      text: "body",
      attachments: [{ name: "invoice.pdf", type: "application/pdf", bytes: PDF_BYTES }],
    }),
  );

  const summary = await t.script<EmailSummary>(
    `import { describe } from 'env:email';
     export default async function main() { return describe('/inbox/thread.eml'); }`,
  );
  assert.equal(summary.subject, "Test message");
  assert.deepEqual(summary.attachments, [
    { name: "invoice.pdf", bytes: PDF_BYTES.byteLength, contentType: "application/pdf", inline: false },
  ]);
  assert.equal(summary.textCharacters, 4);
  assert.equal(await t.fs.exists("/inbox/thread.attachments/invoice.pdf"), false, "describe must not extract");
});

// ================================================== attachments into the tree

test("attachment bytes arrive in the tree byte for byte", async () => {
  const t = await env();
  await t.fs.writeFile(
    "/inbox/thread.eml",
    buildEml({
      text: "two files",
      attachments: [
        { name: "invoice.pdf", type: "application/pdf", bytes: PDF_BYTES },
        { name: "regions.csv", type: "text/csv", bytes: CSV_BYTES },
      ],
    }),
  );

  const mail = await t.script<ExtractedEmail>(
    `import { extract } from 'env:email';
     export default async function main() { return extract('/inbox/thread.eml'); }`,
  );

  assert.equal(mail.dir, "/inbox/thread.attachments");
  assert.deepEqual(
    mail.attachments.map((a) => a.path).sort(),
    ["/inbox/thread.attachments/invoice.pdf", "/inbox/thread.attachments/regions.csv"],
  );

  // The assertion that matters: not "a file exists" but "these are the same
  // bytes". Base64 decoding is exactly the step that can lose a final block.
  assert.deepEqual(
    Array.from(await t.fs.readBytes("/inbox/thread.attachments/invoice.pdf")),
    Array.from(PDF_BYTES),
  );
  assert.deepEqual(
    Array.from(await t.fs.readBytes("/inbox/thread.attachments/regions.csv")),
    Array.from(CSV_BYTES),
  );
  assert.equal(mail.attachments.find((a) => a.name === "invoice.pdf")?.contentType, "application/pdf");
});

test("an extracted attachment is a normal file the other adapters can read", async () => {
  // The reason the adapter exists, stated as a test: the envelope disappears
  // and what is left is a path.
  const t = await env();
  await t.fs.writeFile(
    "/inbox/thread.eml",
    buildEml({ text: "see attached", attachments: [{ name: "regions.csv", type: "text/csv", bytes: CSV_BYTES }] }),
  );

  const total = await t.script<{ path: string; total: number }>(
    `import { extract } from 'env:email';
     import { readFile } from 'env:fs';
     import { csv } from 'env:std';
     export default async function main() {
       const mail = await extract('/inbox/thread.eml');
       const path = mail.attachments[0].path;
       let total = 0;
       for (const row of csv.parse(await readFile(path))) total += Number(row.amount);
       return { path, total };
     }`,
  );
  assert.equal(total.path, "/inbox/thread.attachments/regions.csv");
  assert.equal(total.total, 2030, "the CSV was not readable as a CSV after coming out of the message");
});

test("a chosen directory and an include filter both hold", async () => {
  const t = await env();
  await t.fs.writeFile(
    "/inbox/thread.eml",
    buildEml({
      text: "mixed bag",
      attachments: [
        { name: "invoice.pdf", type: "application/pdf", bytes: PDF_BYTES },
        { name: "regions.csv", type: "text/csv", bytes: CSV_BYTES },
      ],
    }),
  );

  const mail = await t.script<ExtractedEmail>(
    `import { extract } from 'env:email';
     export default async function main() {
       return extract('/inbox/thread.eml', { dir: '/out/mail', include: '*.pdf' });
     }`,
  );
  assert.deepEqual(mail.attachments.map((a) => a.path), ["/out/mail/invoice.pdf"]);
  assert.equal(await t.fs.exists("/out/mail/regions.csv"), false);
});

test("inline images stay out of the way unless asked for", async () => {
  const t = await env();
  await t.fs.writeFile(
    "/inbox/signed.eml",
    buildEml({
      text: "hello",
      html: '<p>hello <img src="cid:logo@acme"></p>',
      attachments: [
        { name: "logo.png", type: "image/png", bytes: utf8("PNG-ish"), inline: true, cid: "logo@acme" },
        { name: "invoice.pdf", type: "application/pdf", bytes: PDF_BYTES },
      ],
    }),
  );

  const without = await t.script<ExtractedEmail>(
    `import { extract } from 'env:email';
     export default async function main() { return extract('/inbox/signed.eml'); }`,
  );
  assert.deepEqual(without.attachments.map((a) => a.name), ["invoice.pdf"]);
  assert.match(String(without.note), /inline part/);

  const with_ = await t.script<ExtractedEmail>(
    `import { extract } from 'env:email';
     export default async function main() { return extract('/inbox/signed.eml', { dir: '/out/all', inline: true }); }`,
  );
  assert.deepEqual(with_.attachments.map((a) => a.name).sort(), ["invoice.pdf", "logo.png"]);
  assert.equal(with_.attachments.find((a) => a.name === "logo.png")?.contentId, "logo@acme");
});

// ================================================ hostile attachment names

test("an attachment named to escape the directory cannot", async () => {
  const t = await env();
  const hostile = [
    "../../escaped.txt",
    "/etc/passwd",
    "..\\..\\escaped.txt",
    "....//escaped.txt",
    "..",
    "",
  ];
  await t.fs.writeFile(
    "/inbox/hostile.eml",
    buildEml({
      text: "nasty",
      attachments: hostile.map((name, i) => ({ name, type: "text/plain", bytes: utf8(`payload ${i}`) })),
    }),
  );

  const mail = await t.script<ExtractedEmail>(
    `import { extract } from 'env:email';
     export default async function main() { return extract('/inbox/hostile.eml', { dir: '/out/dest' }); }`,
  );

  for (const written of mail.attachments) {
    assert.ok(written.path.startsWith("/out/dest/"), `${written.path} escaped the destination`);
    assert.doesNotMatch(written.path.slice("/out/dest/".length), /\//, "a name became a path");
  }
  assert.equal(await t.fs.exists("/escaped.txt"), false);
  assert.equal(await t.fs.exists("/etc/passwd"), false);
  assert.equal(await t.fs.exists("/out/escaped.txt"), false);
});

test("safeName reduces every spelling of a path to a bare name", async () => {
  // Unit-level because the interesting cases are cheap to enumerate here and
  // expensive to smuggle through a MIME header one at a time.
  assert.equal(safeName("../../etc/passwd", "x"), "passwd");
  assert.equal(safeName("/etc/passwd", "x"), "passwd");
  assert.equal(safeName("..\\..\\windows\\system32", "x"), "system32");
  assert.equal(safeName("..", "x"), "x");
  assert.equal(safeName(".", "x"), "x");
  assert.equal(safeName("", "x"), "x");
  assert.equal(safeName("   ", "x"), "x");
  assert.equal(safeName("re\u0000port.pdf", "x"), "report.pdf");
  assert.equal(safeName("a\nb.pdf", "x"), "ab.pdf");
  assert.equal(safeName("ordinary name.pdf", "x"), "ordinary name.pdf");
});

test("two attachments with one name both survive, under different paths", async () => {
  const t = await env();
  await t.fs.writeFile(
    "/inbox/dupes.eml",
    buildEml({
      text: "same name twice",
      attachments: [
        { name: "report.pdf", type: "application/pdf", bytes: utf8("first") },
        { name: "report.pdf", type: "application/pdf", bytes: utf8("second") },
      ],
    }),
  );

  const mail = await t.script<ExtractedEmail>(
    `import { extract } from 'env:email';
     export default async function main() { return extract('/inbox/dupes.eml'); }`,
  );
  assert.deepEqual(mail.attachments.map((a) => a.name), ["report.pdf", "report-2.pdf"]);
  assert.equal(Buffer.from(await t.fs.readBytes(mail.attachments[0].path)).toString(), "first");
  assert.equal(Buffer.from(await t.fs.readBytes(mail.attachments[1].path)).toString(), "second");
});

// ============================================================ Outlook .msg

test("an Outlook .msg yields the same shape, attachments and all", async () => {
  const t = await env();
  await t.fs.writeFile(
    "/inbox/outlook.msg",
    buildMsg({
      subject: "Invoice — March",
      text: "Please find the invoice attached. Total 3775.20 EUR.",
      attachments: [{ name: "invoice.pdf", bytes: PDF_BYTES }],
    }),
  );

  const mail = await t.script<ExtractedEmail>(
    `import { extract } from 'env:email';
     export default async function main() { return extract('/inbox/outlook.msg'); }`,
  );
  assert.equal(mail.format, "msg");
  assert.equal(mail.subject, "Invoice — March");
  assert.deepEqual(mail.from, { name: "Dana Ruiz", address: "dana@acme.example" });
  assert.deepEqual(mail.to.map((a) => a.address), ["ops@carrier.example"]);
  assert.deepEqual(mail.cc.map((a) => a.address), ["audit@acme.example"]);
  assert.equal(mail.date, "2024-03-12T08:14:00.000Z");
  assert.match(mail.text, /Total 3775\.20 EUR/);

  assert.deepEqual(mail.attachments.map((a) => a.path), ["/inbox/outlook.attachments/invoice.pdf"]);
  assert.deepEqual(
    Array.from(await t.fs.readBytes("/inbox/outlook.attachments/invoice.pdf")),
    Array.from(PDF_BYTES),
    "the .msg attachment did not survive the OLE round trip intact",
  );
});

// ============================================================== recognition

test("the format is decided by content, not by the file name", async () => {
  const t = await env();
  // A message saved by an export tool as `1.txt`, and an Outlook message
  // saved without its extension. Both must still open.
  await t.fs.writeFile("/inbox/1.txt", buildEml({ text: "no extension to go on" }));
  await t.fs.writeFile("/inbox/nameless", buildMsg({ subject: "Outlook", text: "compound file" }));

  const eml = await t.script<EmailSummary>(
    `import { describe } from 'env:email';
     export default async function main() { return describe('/inbox/1.txt'); }`,
  );
  assert.equal(eml.format, "eml");
  assert.equal(eml.subject, "Test message");

  const msg = await t.script<EmailSummary>(
    `import { describe } from 'env:email';
     export default async function main() { return describe('/inbox/nameless'); }`,
  );
  assert.equal(msg.format, "msg");
  assert.equal(msg.subject, "Outlook");
});

test("something that is not a message is refused, and so is a mailbox", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/notes.txt", "Just a note. No headers here.\nSecond line.");
  const notMail = await t.runScript(
    `import { describe } from 'env:email';
     export default async function main() { return describe('/inbox/notes.txt'); }`,
  );
  assert.equal(notMail.ok, false);
  assert.match(String(notMail.error), /not an email message/);

  // An mbox parses as its first message and would silently drop the rest —
  // the failure that looks like success. It has to be refused by name.
  const one = Buffer.from(buildEml({ text: "first" })).toString("latin1");
  const two = Buffer.from(buildEml({ text: "second" })).toString("latin1");
  const mbox = `From dana@acme.example Tue Mar 12 09:14:00 2024\r\n${one}\r\nFrom dana@acme.example Wed Mar 13 09:14:00 2024\r\n${two}`;
  await t.fs.writeFile("/inbox/archive.mbox", utf8(mbox));
  const mailbox = await t.runScript(
    `import { describe } from 'env:email';
     export default async function main() { return describe('/inbox/archive.mbox'); }`,
  );
  assert.equal(mailbox.ok, false);
  assert.match(String(mailbox.error), /mbox holding 2 messages/);
  assert.match(String(mailbox.error), /split the mailbox/);
});

test("describe routes through the describe verb by extension", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/thread.eml", buildEml({ text: "routed" }));
  const tool = t.env.tools.find((x) => x.name === "describe")!;
  const summary = JSON.parse(String((await tool.do({ path: "/inbox/thread.eml" })).data));
  assert.equal(summary.module, "env:email");
  assert.equal(summary.format, "eml");
});

test("it does not claim the OLE magic that legacy Office files also carry", async () => {
  // `.doc`, `.xls` and `.ppt` are compound files too. Magic beats extension
  // across every adapter, so claiming D0CF11E0 here would take describe
  // dispatch for all of them and answer "not a readable message".
  const adapter = email();
  assert.equal(adapter.handles?.magic, undefined);
  assert.deepEqual(adapter.handles?.extensions, [".eml", ".msg", ".mbox"]);
});

test("a message with more attachments than the cap is refused rather than written", async () => {
  const t = await createAdapterTestEnv(email({ maxAttachments: 2 }));
  await t.fs.writeFile(
    "/inbox/many.eml",
    buildEml({
      text: "lots",
      attachments: [1, 2, 3].map((n) => ({ name: `f${n}.txt`, type: "text/plain", bytes: utf8(`x${n}`) })),
    }),
  );
  const run = await t.runScript(
    `import { extract } from 'env:email';
     export default async function main() { return extract('/inbox/many.eml'); }`,
  );
  assert.equal(run.ok, false);
  assert.match(String(run.error), /declares 3 attachments, over the 2 cap/);
  assert.equal(await t.fs.exists("/inbox/many.attachments/f1.txt"), false, "nothing should be written on refusal");
});
