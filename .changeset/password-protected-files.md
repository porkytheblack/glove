---
"glove-env-documents": minor
"glove-env-spreadsheets": minor
"glove-env-slides": minor
"glove-env-render": minor
"glove-env-ocr": minor
"glove-env-zip": minor
"glove-env-unlock": patch
---

Add a shared `unlock(input, output, { password })` operation for password-protected
PDFs, OOXML Word/Excel/PowerPoint documents and AES/ZipCrypto ZIP archives. Each
file adapter exposes it and can use the resulting unencrypted VFS copy through
its existing readers, editors, rendering and OCR paths. Preserve source files,
refuse existing destinations, enforce output limits and suppress password values
in decryption errors. Expose a host-side binding for passwords that must stay out
of persisted scripts and run arguments.
