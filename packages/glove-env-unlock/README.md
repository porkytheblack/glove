# glove-env-unlock

Open password-protected files inside a Glove working environment using a
known password. No native binaries, Python runtime, network upload or host
temporary files are required. Decryption libraries load on first use.

The documents, spreadsheets, slides, archives, render and OCR adapters each
export the same `unlock(input, output, { password })` operation. The optional
standalone `unlock()` adapter exposes it as `env:unlock`.

```ts
import { unlock, pdf } from 'env:documents';

export default async function main({ password }) {
  const path = await unlock('/inbox/statement.pdf', '/tmp/statement.pdf', { password });
  return pdf.extractText(path);
}
```

The returned path contains an unencrypted copy, usable by any registered
adapter. Keep the input's file extension. The input and existing destination
files are preserved. Incorrect passwords, damaged files and unsupported
encryption fail without writing a result. Normal VFS zones, capacity limits
and cancellation checks govern the output write. ZIP entry count and actual
inflation are bounded as well.

| Input | Supported protection |
| --- | --- |
| PDF | Standard password security: RC4, AES-128, AES-256 |
| DOCX, XLSX, PPTX | Office OOXML Standard and Agile encryption |
| ZIP | AES and ZipCrypto, including mixed encrypted/plain entries |

Empty PDF passwords are supported. Legacy DOC/XLS/PPT, ODF encryption,
certificate/DRM protection, RAR and 7z are outside this API. Unlocking does
not convert formats or recover unknown passwords. Editing restrictions on
unencrypted Office documents are separate from file encryption.

## Host-side passwords

Working-environment script arguments are recorded in run history; saved
scripts are also persisted. For sensitive passwords, unlock on the host
before giving the agent the working path:

```ts
import { createUnlockBinding } from 'glove-env-unlock';

const path = await createUnlockBinding(env.fs)(
  '/inbox/statement.pdf',
  '/tmp/statement.pdf',
  { password: suppliedPassword },
);
// Give the agent `path` to read, render or OCR.
```

This call does not record the password in working-environment script history.
Library errors are replaced with messages that do not include the password.
The output is ordinary unencrypted VFS content: snapshots include it, and
normal file-history retention applies. Choose persistence accordingly.

The implementation uses [Cantoo PDF-lib](https://github.com/cantoo-scribe/pdf-lib),
[officecrypto-tool](https://github.com/zurmokeeper/officecrypto-tool), and
[zip.js](https://github.com/gildas-lormeau/zip.js).
