import { defineAdapter, normalizePath, type EnvFsHandle } from "glove-working-environment";

export interface UnlockOptions {
  /** The supplied file password. An empty password is valid. */
  password: string;
}

export const UNLOCK_TYPES = `
/** Decrypt a PDF, DOCX/XLSX/PPTX or ZIP to a new, unencrypted VFS file.
 * The destination must not exist. Use the returned path with any adapter.
 * Supply the known password; this does not discover or recover passwords.
 */
export function unlock(input: string, output: string, options: { password: string }): Promise<string>;
`;

export const UNLOCK_DOCS = `

## Password-protected files

Call \`unlock(input, output, { password })\` with the supplied password before
reading a protected file. It supports PDF, encrypted OOXML (DOCX/XLSX/PPTX),
and ZIP (AES or ZipCrypto). It returns a new, unencrypted path usable by
documents, spreadsheets, slides, archives, render and OCR. Keep the original
extension on the output. The source is preserved and existing destinations
are refused. Unsupported encryption and incorrect passwords fail without
writing a result. Legacy Office, ODF, RAR and 7z are not supported here.

For example, inside a script importing \`unlock\` and \`pdf\` from
\`env:documents\`:

\`\`\`ts
const path = await unlock('/inbox/statement.pdf', '/tmp/statement.pdf', { password });
return pdf.extractText(path);
\`\`\`

The password is a call input, never part of the returned result or library
error. Do not hard-code it in saved scripts or include it in output. Script
arguments are recorded in working-environment run history. For a
password that must stay out of that history, the host should call
\`createUnlockBinding(env.fs)(input, output, { password })\` from
\`glove-env-unlock\` before handing the output path to the agent. The
unencrypted copy is ordinary VFS content and will be included in snapshots;
normal file-history retention applies even after removing the working copy.
`;

const starts = (bytes: Uint8Array, signature: number[]) => signature.every((b, i) => bytes[i] === b);

/** A bounded sink for ZIP decompression and output, including dishonest size headers. */
function sink(limit: number) {
  const chunks: Uint8Array[] = [];
  let size = 0;
  return {
    stream: new WritableStream<Uint8Array>({
      write(chunk) {
        size += chunk.byteLength;
        if (size > limit) throw new Error("Unlocked ZIP exceeds the file size limit");
        chunks.push(new Uint8Array(chunk));
      },
    }),
    bytes() {
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return bytes;
    },
  };
}

async function unlockZip(bytes: Uint8Array, password: string, limit: number): Promise<Uint8Array> {
  const { ZipReader, ZipWriter, Uint8ArrayReader } = await import("@zip.js/zip.js");
  const reader = new ZipReader(new Uint8ArrayReader(bytes), { useWebWorkers: false });
  const output = sink(limit);
  const writer = new ZipWriter(output.stream, { useWebWorkers: false });
  let total = 0;
  let count = 0;
  try {
    for await (const entry of reader.getEntriesGenerator()) {
      if (++count > 20_000) throw new Error("ZIP exceeds the entry count limit");
      total += entry.uncompressedSize;
      if (!Number.isSafeInteger(total) || total > limit) throw new Error("ZIP exceeds the file size limit");
      // This only rewrites a container; extraction adapters still validate paths.
      if (entry.directory) {
        await writer.add(entry.filename, undefined, { directory: true });
      } else {
        const content = sink(Math.min(entry.uncompressedSize, limit));
        await entry.getData(content.stream, { password, checkSignature: true });
        await writer.add(entry.filename, new Uint8ArrayReader(content.bytes()), { level: 0 });
      }
    }
    await writer.close();
    return output.bytes();
  } finally {
    await reader.close();
  }
}

/** Shared by every file adapter; libraries load only when a file is unlocked. */
export function createUnlockBinding(vfs: EnvFsHandle) {
  return async function unlock(input: string, output: string, options: UnlockOptions): Promise<string> {
    if (!options || typeof options.password !== "string") {
      throw new TypeError("unlock requires { password: string }; supply the file password (which may be empty)");
    }
    const destination = normalizePath(output);
    if (normalizePath(input) === destination || await vfs.exists(destination)) {
      throw new Error("unlock needs a new output path; the source and existing files are preserved");
    }
    const bytes = await vfs.readBytes(input);
    const limit = Math.min(vfs.limits.maxFileBytes, vfs.limits.maxVfsBytes);
    if (bytes.length > limit) throw new Error("Protected file exceeds the environment's file size limit");
    let result: Uint8Array;
    if (starts(bytes, [0x25, 0x50, 0x44, 0x46])) {
      const { PDFDocument, PDFRawStream, PDFName, PDFRef } = await import("@cantoo/pdf-lib");
      try {
        const source = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
        const doc = source.isEncrypted
          ? await PDFDocument.load(bytes, { password: options.password, updateMetadata: false })
          : source;
        if (source.isEncrypted) {
          // Cross-reference streams are NOT encrypted. The decrypting parser
          // can mistake their plaintext IDs for ciphertext and retain them as
          // invalid objects, including stale /Encrypt references. Identify them
          // in the original parse and discard them before the full rewrite.
          for (const [ref, object] of source.context.enumerateIndirectObjects()) {
            if (object instanceof PDFRawStream && object.dict.get(PDFName.of("Type")) === PDFName.of("XRef")) {
              doc.context.delete(ref);
            }
          }
          const trailer = source.context.trailerInfo;
          if (trailer.Encrypt instanceof PDFRef) doc.context.delete(trailer.Encrypt);
          delete doc.context.trailerInfo.Encrypt;
          // The original trailer contains references, not encrypted content.
          // Restore metadata references lost when a plaintext xref failed parsing.
          doc.context.trailerInfo.Root = trailer.Root;
          doc.context.trailerInfo.Info = trailer.Info;
          doc.context.trailerInfo.ID = trailer.ID;
        }
        result = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });
      } catch {
        throw new Error("Cannot unlock PDF: incorrect password, unsupported encryption, or damaged file");
      }
    } else if (starts(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
      const { default: office } = await import("officecrypto-tool");
      try {
        result = new Uint8Array(await office.decrypt(Buffer.from(bytes), { password: options.password }));
        if (!starts(result, [0x50, 0x4b])) throw new Error("Not OOXML");
      } catch {
        throw new Error("Cannot unlock Office file: incorrect password, unsupported encryption, or damaged file; expected DOCX/XLSX/PPTX");
      }
    } else if (starts(bytes, [0x50, 0x4b])) {
      try {
        result = await unlockZip(bytes, options.password, limit);
      } catch {
        throw new Error("Cannot unlock ZIP: incorrect password, unsupported encryption, damaged file, or size/entry limit exceeded");
      }
    } else {
      throw new Error("unlock supports PDF, encrypted DOCX/XLSX/PPTX and ZIP files");
    }
    if (result.byteLength > limit) throw new Error("Unlocked file exceeds the environment's file size limit");
    // Guarded writes enforce zones, remaining VFS capacity and run cancellation.
    if (await vfs.exists(destination)) throw new Error("unlock destination already exists");
    await vfs.writeFile(destination, result);
    return destination;
  };
}

/** Optional standalone module; file adapters also expose the same unlock binding. */
export const unlock = () => defineAdapter({
  name: "unlock",
  description: "Open password-protected PDFs, Office documents and ZIPs as unencrypted working copies.",
  types: UNLOCK_TYPES,
  docs: UNLOCK_DOCS,
  create: (vfs: EnvFsHandle) => ({ unlock: createUnlockBinding(vfs) }),
});

export default unlock;
