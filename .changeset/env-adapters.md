---
"glove-env-documents": minor
"glove-env-spreadsheets": minor
"glove-env-images": minor
---

Three stdlib adapter packages for `glove-working-environment`, each carrying its own heavy dependency so the core stays zero-dependency.

`glove-env-spreadsheets` (`env:spreadsheets`, exceljs) makes `.xlsx` workbooks readable as plain JSON. exceljs returns rich objects — `{ richText: [...] }`, `{ formula, result }`, `{ error: '#DIV/0!' }`, `Date`s, hyperlink pairs — and handing those to a model spends tokens saying nothing while teaching it to write defensive unwrapping; everything is flattened at the boundary, with `read({ formulas: true })` for when the formula text is the point. `describe(path)` summarises sheets, sizes, headers and one sample row at a cost independent of file size, and `read` reports `totalRows` so `offset`/`limit` paging has an obvious loop condition. Blank headers become their column letter and duplicates get a `_2` suffix so no column is silently dropped, and `append` follows the sheet's existing header order rather than the incoming record's key order.

`glove-env-documents` (`env:documents`, pdf-lib + docx) renders one document spec — headings, text, bullets, tables, images, page breaks — to both PDF and DOCX, wrapping and paginating on its own. `describe(path)` sniffs the format from the bytes rather than the extension. PDF text extraction is delegated to an optional `pdfjs-dist` peer and refuses cleanly when it is absent: decoding glyphs back to characters is a font/CMap problem, and a naive content-stream scan returns plausible nonsense on any subsetted font, which a model cannot tell from the real thing. DOCX extraction needs no extra dependency — a `.docx` is a ZIP of XML, read here with `node:zlib`. pdf-lib's standard fonts are WinAnsi-only and throw on an em dash, so non-Latin-1 characters are transliterated where there is an obvious equivalent rather than failing an entire render; the docs point at DOCX for full Unicode.

`glove-env-images` (`env:images`, sharp) keeps image bytes out of the context window entirely: `describe(path)` answers what a file is without decoding pixels, `stats(path)` adds channel spread and dominant colour (enough to tell a blank scan from a real one, ignoring alpha so transparent PNGs do not read as dark), and everything else turns one path into another. The output extension picks the encoder unless `{ format }` overrides it. EXIF orientation is surfaced rather than silently applied, because cropping a sideways image without normalising first gives coordinates on the wrong axis and nothing else would say so.

All three follow the §4.4 convention — paths in, paths out, structured data in between — expose `describe(path)`, validate arguments before reaching the underlying library so failures are sentences rather than library stack traces, and are tested from inside real scripts via `glove-working-environment/testing`.
