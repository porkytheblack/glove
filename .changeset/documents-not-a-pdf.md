---
"glove-env-documents": patch
---

Say a file is not a PDF, rather than that the PDF is broken.

Found by agent evaluation. Pointing `pdf.extractText` at a text file returned pdf-lib's own `Invalid PDF structure.`, which reads as "this document is corrupt" — so a model goes looking for a different extractor instead of noticing it opened the wrong file.

Files are now checked for the `%PDF-` header before any parser sees them, and the refusal names what the file appears to be:

```
/tmp/notes.txt is not a PDF: it does not start with the %PDF- header.
It looks like text — read it with env:fs.readFile instead.
```

A ZIP gets the more useful version of the same, since `.docx`, `.xlsx` and `.pptx` are all ZIPs and the answer is which module to reach for rather than which parser to retry.

`describe` and the internal loader already wrapped their failures as "could not be read as a PDF"; `extractText` wrapped nothing, which is why it was the one that surfaced. All three share the check now, and the wrapping is left to handle genuinely malformed PDFs — the case it was written for.
