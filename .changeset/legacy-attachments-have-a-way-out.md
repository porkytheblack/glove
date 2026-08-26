---
"glove-env-render": minor
"glove-working-environment": minor
---

A legacy attachment stops being a dead end

Two lists inside `env:render` had drifted apart, and one of them was the one dispatch reads.

`classify()` accepts the legacy `.doc`, `.xls`, `.ppt` and `.rtf` — LibreOffice opens all four — plus `.avif`. `renders.extensions`, which is what `view_image` and the handler registry consult, declared none of them. So the same adapter gave opposite answers about the same file:

```
render('/inbox/old.doc', '/tmp/out')   → runs, reaches LibreOffice
view_image('/inbox/old.doc', '…')      → "none of env:render claims this format"
```

Nothing failed loudly, which is why it lasted. The declaration now matches what `classify` accepts, and a test pins the two together rather than trusting them to stay in step.

**`describe` names the way out.** An unclaimed file reported *"no registered module claims this file"* and stopped there, even when a registered renderer could turn it into something readable — the exact case being a legacy `.doc` off an email, which nothing parses and LibreOffice opens fine. The note now names the renderer, `render`, `view_image` and `env:ocr` as the path from bytes to text. A file with no renderer gets no such advice, because advice on every file is advice nobody reads.

**A `.rtf` says its preview is markup.** RTF is text, so it fell through to the generic summary and `preview` came back as control words — which reads like content, and a caller quoting it would quote `{\rtf1\ansi …}` at a user as if it were the document.

**A claimed file that could not be read no longer contradicts itself.** `describe` reported `module: env:images` and a `moduleError` beside a note reading "no registered module claims this file". Those call for opposite next steps. The note now says which module claimed it and points at `moduleError`, which for a truncated download or a mislabelled extension is usually the actual answer.
