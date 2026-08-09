---
"glove-env-spreadsheets": patch
"glove-env-slides": patch
"glove-env-documents": patch
"glove-env-render": patch
---

Close two ways out of the sandbox, and stop three readers inflating without a bound

**A script could put any host file it could name into a deliverable.** `new Workbook().addImage({ filename: '/etc/…' })` and, on a deck, `addMedia({ path })` or `background: { path }` are all resolved by the library itself — exceljs and pptxgenjs each open the path off the *real* filesystem at write time, not off the agent's tree. Nothing failed, nothing was logged: the workbook or deck was written, `present`ed, and the file's bytes went out with it. `addImage` on slides was already routed through the guarded VFS handle for exactly this reason; the other three were not. They are now, and a path the tree does not have fails on the call that named it rather than on the write. A slide's background is *assigned* rather than called, which argument rewriting structurally cannot see, so that one is resolved at write time instead — the same defence one step later, at the point the library would otherwise reach for the disk.

**A 200 KB upload could take the process down.** The documents, slides and render OOXML readers called `inflateRawSync` with no `maxOutputLength`, so a crafted `.docx` or `.pptx` inflated unbounded on the host heap during an ordinary `describe` or `extractText` — outside VFS accounting, in a process that may be serving other agents. The declared uncompressed size is no help, because it comes out of the same hostile file; the bound has to be on the inflate's output, which is what the archives adapter has always done. All three now cap inflation at the environment's `maxVfsBytes` (the live value where the reader is given a VFS handle, the default where it is handed bytes alone) and refuse the entry by name when it is exceeded.

**An encrypted Office file was read as a broken one.** Inflating ciphertext yields garbage rather than an error, so a password-protected `.docx` came back as "not a Word document" and a protected `.pptx` as "no ppt/slides/" — both true, neither actionable. The ZIP encryption flag is now checked and named, so the answer is the password rather than the file.
