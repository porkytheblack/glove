import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "@cantoo/pdf-lib";
import office from "officecrypto-tool";
import { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader } from "@zip.js/zip.js";
import { createAdapterTestEnv, assertAdapterOk } from "glove-working-environment/testing";
import { unlock, createUnlockBinding } from "../src/index";
import { documents } from "../../glove-env-documents/src/index";
import { spreadsheets } from "../../glove-env-spreadsheets/src/index";
import { slides } from "../../glove-env-slides/src/index";
import { render } from "../../glove-env-render/src/index";
import { ocr } from "../../glove-env-ocr/src/index";
import { archives } from "../../glove-env-zip/src/index";

const password = "statement-secret-482";

async function encryptedPdf(algorithm: string, userPassword = password) {
  const name = userPassword === "" ? "empty" : algorithm;
  return new Uint8Array(await readFile(new URL(`./fixtures/${name}.pdf`, import.meta.url)));
}

test("all file adapters expose unlock with matching script declarations", async () => {
  for (const adapter of [unlock(), documents(), spreadsheets(), slides(), render(), ocr(), archives()]) {
    const t = await createAdapterTestEnv(adapter);
    try {
      assertAdapterOk(await t.audit());
      assert.equal(await t.script(`import { unlock } from 'env:${adapter.name}';
        export default function main() { return typeof unlock; }`), "function");
    } finally { await t.env.close(); }
  }
});

for (const algorithm of ["AES-256", "AES-256-R5", "AES-128", "RC4-128", "RC4-40"] as const) {
  test(`${algorithm} PDF unlock preserves text, metadata and source; renders and OCR inspects the copy`, async () => {
    const t = await createAdapterTestEnv(documents(), { also: [render(), ocr()] });
    try {
      const input = await encryptedPdf(algorithm);
      await t.fs.writeFile("/inbox/statement.pdf", input);
      const text = await t.script<{ text: string }>(`
        import { unlock, pdf } from 'env:documents';
        export default async function main({ password }) {
          const path = await unlock('/inbox/statement.pdf', '/tmp/open.pdf', { password });
          return pdf.extractText(path);
        }`, { password });
      assert.match(text.text, /Balance: 1234.56/);
      assert.deepEqual(await t.fs.readBytes("/inbox/statement.pdf"), input);
      const info = await t.script<{ title: string; encrypted: boolean }>(`import { pdf } from 'env:documents';
        export default async function main() { return pdf.describe('/tmp/open.pdf'); }`);
      assert.equal(info.title, "Bank statement");
      assert.equal(info.encrypted, false);
      const result = await t.script<{ pages: unknown[] }>(`import { render } from 'env:render';
        export default async function main() { return render('/tmp/open.pdf', '/tmp/pages'); }`);
      assert.equal(result.pages.length, 1);
      const scan = await t.script<{ textLayerPages: number[] }>(`import { describe } from 'env:ocr';
        export default async function main() { return describe('/tmp/open.pdf'); }`);
      assert.deepEqual(scan.textLayerPages, [1]);
    } finally { await t.env.close(); }
  });
}

test("an encrypted scanned PDF with object streams unlocks through OCR and recognizes its balance", async () => {
  const t = await createAdapterTestEnv(ocr(), { also: [render()] });
  try {
    await t.fs.writeFile("/inbox/digital.pdf", await encryptedPdf("AES-256"));
    await createUnlockBinding(t.fs)("/inbox/digital.pdf", "/tmp/digital.pdf", { password });
    const rendered = await t.script<{ pages: Array<{ path: string }> }>(`import { render } from 'env:render';
      export default async function main() { return render('/tmp/digital.pdf', '/tmp/pixels', { scale: 3 }); }`);
    const scan = await PDFDocument.create();
    const image = await scan.embedPng(await t.fs.readBytes(rendered.pages[0].path));
    scan.addPage([400, 400]).drawImage(image, { x: 0, y: 0, width: 400, height: 400 });
    scan.encrypt({ userPassword: password, ownerPassword: "owner", algorithm: "AES-256" });
    await t.fs.writeFile("/inbox/scan.pdf", await scan.save({ useObjectStreams: true }));
    const recognized = await t.script<{ text: string }>(`import { unlock, recognize } from 'env:ocr';
      export default async function main({ password }) {
        const path = await unlock('/inbox/scan.pdf', '/tmp/scan.pdf', { password });
        return recognize(path);
      }`, { password });
    assert.match(recognized.text, /Balance:\s*1234\.56/);
    assert.equal((await PDFDocument.load(await t.fs.readBytes("/tmp/scan.pdf"))).isEncrypted, false);
  } finally { await t.env.close(); }
});

test("missing and wrong PDF passwords leave no output; empty PDF passwords work", async () => {
  const t = await createAdapterTestEnv(unlock());
  try {
    await t.fs.writeFile("/inbox/a.pdf", await encryptedPdf("AES-256"));
    const open = createUnlockBinding(t.fs);
    await assert.rejects(open("/inbox/a.pdf", "/tmp/a.pdf", undefined as never), /requires/);
    await assert.rejects(open("/inbox/a.pdf", "/tmp/a.pdf", { password: "wrong-private-value" }), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /incorrect password/);
      assert.ok(!String(error.stack).includes("wrong-private-value"));
      return true;
    });
    assert.equal(await t.fs.exists("/tmp/a.pdf"), false);
    await t.fs.writeFile("/inbox/empty.pdf", await encryptedPdf("AES-128", ""));
    await open("/inbox/empty.pdf", "/tmp/empty.pdf", { password: "" });
    assert.equal((await PDFDocument.load(await t.fs.readBytes("/tmp/empty.pdf"))).isEncrypted, false);
  } finally { await t.env.close(); }
});

for (const type of [undefined, "standard"] as const) {
  for (const format of ["docx", "xlsx", "pptx"] as const) {
    test(`${format} Office ${type ?? "agile"} decryption feeds the existing reader`, async () => {
      const t = await createAdapterTestEnv(documents(), { also: [spreadsheets(), slides()] });
      try {
        const spec = { title: "Statement", content: [{ text: "Balance 1234" }] };
        const scripts = {
          docx: `import { docx } from 'env:documents'; export default async function main() {
            return docx.create('/tmp/original.docx', ${JSON.stringify(spec)}); }`,
          xlsx: `import { write } from 'env:spreadsheets'; export default async function main() {
            return write('/tmp/original.xlsx', [{ account: 'Checking', balance: 1234 }]); }`,
          pptx: `import { create } from 'env:slides'; export default async function main() {
            return create({ title: 'Statement', slides: [{ title: 'Balance', bullets: ['1234'] }] }, '/tmp/original.pptx'); }`,
        };
        await t.script(scripts[format]);
        const original = await t.fs.readBytes(`/tmp/original.${format}`);
        const encrypted = office.encrypt(Buffer.from(original), type ? { password, type } : { password });
        await t.fs.writeFile(`/inbox/protected.${format}`, encrypted);
        const open = createUnlockBinding(t.fs);
        await assert.rejects(open(`/inbox/protected.${format}`, `/tmp/open.${format}`, { password: "wrong" }), /incorrect password/);
        assert.equal(await t.fs.exists(`/tmp/open.${format}`), false);
        const module = { docx: "documents", xlsx: "spreadsheets", pptx: "slides" }[format];
        const summary = await t.script<{ format: string }>(`import { unlock, describe } from 'env:${module}';
          export default async function main({ password }) {
            const path = await unlock('/inbox/protected.${format}', '/tmp/open.${format}', { password });
            return describe(path);
          }`, { password });
        assert.equal(summary.format, format);
        assert.deepEqual(await t.fs.readBytes(`/tmp/open.${format}`), original);
      } finally { await t.env.close(); }
    });
  }
}

for (const zipCrypto of [false, true]) {
  test(`${zipCrypto ? "ZipCrypto" : "AES"} ZIP decrypts for the existing archive extractor`, async () => {
    const t = await createAdapterTestEnv(archives());
    try {
      const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
      await writer.add("statement.txt", new Uint8ArrayReader(new TextEncoder().encode("Balance 1234")), { password, zipCrypto });
      await t.fs.writeFile("/inbox/protected.zip", await writer.close());
      const open = createUnlockBinding(t.fs);
      await assert.rejects(open("/inbox/protected.zip", "/tmp/open.zip", { password: "wrong" }), /incorrect password/);
      assert.equal(await t.fs.exists("/tmp/open.zip"), false);
      await t.script(`import { unlock, extract } from 'env:archives';
        export default async function main({ password }) {
          const path = await unlock('/inbox/protected.zip', '/tmp/open.zip', { password });
          return extract(path, '/tmp/extracted');
        }`, { password });
      assert.equal(await t.fs.readFile("/tmp/extracted/statement.txt"), "Balance 1234");
    } finally { await t.env.close(); }
  });
}

test("unlock refuses overwrites, protected zones, unsupported files and oversized ZIP expansion", async () => {
  const t = await createAdapterTestEnv(unlock());
  try {
    await t.fs.writeFile("/inbox/a.pdf", await encryptedPdf("AES-128"));
    const open = createUnlockBinding(t.fs);
    await assert.rejects(open("/inbox/a.pdf", "/inbox/a.pdf", { password }), /new output path/);
    await t.fs.writeFile("/tmp/existing.pdf", "preserve me");
    await assert.rejects(open("/inbox/a.pdf", "/tmp/existing.pdf", { password }), /new output path/);
    assert.equal(await t.fs.readFile("/tmp/existing.pdf"), "preserve me");
    await assert.rejects(open("/inbox/a.pdf", "/std/secret.pdf", { password }));
    assert.equal(await t.fs.exists("/std/secret.pdf"), false);
    await assert.rejects(open("/tmp/existing.pdf", "/tmp/no.pdf", { password }), /supports PDF/);
    const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
    await writer.add("large.txt", new Uint8ArrayReader(new Uint8Array(100_000)), { password });
    await t.fs.writeFile("/inbox/large.zip", await writer.close());
    const limited = createUnlockBinding({ ...t.fs, limits: { ...t.fs.limits, maxFileBytes: 10_000 } });
    await assert.rejects(limited("/inbox/large.zip", "/tmp/large.zip", { password }), /limit/);
    assert.equal(await t.fs.exists("/tmp/large.zip"), false);
  } finally { await t.env.close(); }
});
