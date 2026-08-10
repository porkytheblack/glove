---
"glove-env-email": minor
---

New adapter: `glove-env-email` — `.eml` and Outlook `.msg`, opened in place, with attachments written into the tree.

An inbox is where the complicated files come from. Before this, an attached `.eml` was a wall: no adapter claimed it, `ls` called it bytes, `describe` had nowhere to route it, and the PDF inside — the thing the user was actually asking about — was unreachable. The whole point of the rest of the environment is opening awkward artifacts, and the commonest envelope they arrive in could not be opened at all.

`describe(path)` gives sender, subject, date and an attachment manifest without writing anything. `extract(path, { dir, include, inline })` returns headers, both bodies and every attachment **as a path in the tree** — an ordinary path that `env:documents`, `env:images`, `env:spreadsheets`, `env:archives` and `env:ocr` take as-is. Once the envelope is open nothing downstream needs to know an email was involved.

**Recognition is by content.** Messages arrive from export tools named `message`, `1.txt`, `forward.eml.txt`, so the bytes decide: an OLE compound file is a `.msg`, a block of RFC 5322 headers carrying at least one header a message must have is an `.eml`, and the extension only breaks ties.

**Attachment filenames are hostile input** — they are chosen by whoever sent the message, and `../../etc/passwd` is a legal MIME filename. The rule is one step rather than a detector: only the basename survives, so a path cannot be spelled at all. Control characters are stripped, `.`/`..`/empty become `attachment-N`, and collisions are disambiguated (`report.pdf`, `report-2.pdf`). Attachment bytes go through the same guarded handle as any other write, so they count against `maxVfsBytes`, and a message declaring more than `maxAttachments` (default 200) is refused before anything lands.

Two things are refused rather than half-done, because both would look like success:

- **`.mbox`**, by message count. Parsing one returns its first message and silently drops the rest.
- **An embedded message inside a `.msg`** (a mail forwarded as an item rather than a file) is reported in `note`, not extracted — writing a fabricated `.msg` that might not load is worse than saying it was skipped.

`handles` claims `.eml`, `.msg` and `.mbox` by extension and declares **no magic bytes**: legacy `.doc`, `.xls` and `.ppt` are compound files too, and magic beats extension across every adapter, so claiming `D0CF11E0` would take `describe` dispatch for all of them in order to answer "not a readable message".

Inline parts — the images an HTML body references as `cid:…` — are skipped by default and counted in `note`, since a long signature carries a dozen and none of them is the document that was wanted.

The `.msg` tests build real OLE compound files with `@tutao/oxmsg` and read them back through the adapter, so the format is genuinely round-tripped rather than mocked; every attachment assertion compares the bytes in to the bytes out, because a base64 decoder that drops its last block would pass a test that only checked a file appeared.
