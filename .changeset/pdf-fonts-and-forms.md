---
"glove-env-documents": minor
---

"Write this PDF in Japanese" produced `????????`, and "fill in this form" had no route at all

Two capabilities sat one call away in pdf-lib and were not offered.

**Non-Latin PDF text was transliterated away.** `pdf.create` embedded Helvetica, whose encoding stops at Latin-1, so every character past it became `?` — measured: `契約書：山田太郎` came back out as eight question marks and `Договор — Иван Петров` as `??????? - ???? ??????`. `pdf.create`, `pdf.stamp` and the new `pdf.fillForm` now take a `font`: a VFS path to a `.ttf`/`.otf`, or `{ regular, bold }`, embedded through fontkit and subsetted to the glyphs actually used. A 6.2 MB Japanese face became a 4 KB PDF, and the Japanese came back out of it character-for-character through pdfjs, which shares no code with the writer.

**A font that cannot draw the text is refused, and this is the part that mattered most.** pdf-lib does not fail on an unmapped code point — it emits glyph 0, which every viewer renders as a blank box. So the document's text is checked against the font's own character set *before* anything is drawn, and the whole document is checked at once: "`/fonts/sans.ttf` has no glyph for 8 characters in this document: "契" (U+5951), …" is one fix, where failing at the first bad character is eight runs. A Latin font is not a CJK font with a few extras, and now it cannot pretend to be one.

The transliteration stays where there is no font, and the two behaviours are opposite on purpose. Substituting a hyphen for an em dash is right when the alternative is failing an entire render over punctuation; substituting a blank box is wrong when the alternative is a page nobody can read. A test pins the `?` fallback so it cannot drift into throwing.

Metadata stopped being transliterated at all. PDF text strings are UTF-16 and need no font, so putting `toWinAnsi` in front of `setTitle` was costing a Japanese title its characters for nothing.

**`pdf.readForm(path)` and `pdf.fillForm(path, values, options?)`** cover AcroForms. `readForm` returns each field's name, kind, current value, permitted `options`, and read-only/required flags; `fillForm` sets them by name, with `{ flatten: true }` to bake the answers into the page.

Reading first is not politeness, it is the whole failure mode: field names are whatever the form's author typed — `topmostSubform[0].Page1[0].f1_04[0]` is a real one — and they are never the labels printed beside the boxes. So **an unknown field name is an error that lists the real ones**, never a no-op, because a call that reports success while setting nothing is indistinguishable from one that worked. Values of the wrong kind are refused the same way, with a dropdown or radio group naming its choices.

An XFA form is refused unless `{ allowXfa: true }`. Setting the AcroForm layer of a dynamic XFA form produces a file that looks filled to this code and blank in Acrobat, which is worse than not filling it; `readForm` reports `xfa: true` with a note either way, and a PDF with no fields at all says it is a flat document rather than returning an empty list for a model to misread as an empty form.

Two upstream limits are named rather than surfaced as library internals: a font *collection* (`.ttc`/`.otc`) is refused with its faces listed, because neither pdf-lib nor fontkit can pick one; and a font that parses but that pdf-lib's embedder rejects — four of the 47 faces on the development host do this — reports which file and suggests a TrueType build, instead of "Not a CFF Font".

Adds `@pdf-lib/fontkit` as a dependency. 19 tests added, every claim about text on a page verified by reading the glyphs back with pdfjs, and the form values verified by flattening them onto the page — a widget annotation's value can be recorded correctly and still never be drawn.
