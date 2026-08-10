---
"glove-env-zip": patch
"glove-env-email": patch
---

Describe the extraction defences without embedding attack payloads.

npm was returning `E403 Forbidden` on `PUT` for both packages, for five days
and across three different names (`glove-env-archives`, `glove-env-zip`,
`glove-env-email`). It was not the name, the account, the manifest or the
publish command — `glove-env-ocr`, a brand-new package, was created from the
same machine with the same `pnpm publish` two minutes after one of the
failures.

What the two blocked packages had in common was their published bytes. Both
parse untrusted binary formats and extract files out of them, and both
documented that defence by naming the attack: the shipped bundle carried
`etc/passwd`, `../../` and "decompression bomb", inlined from the
model-facing docs blob and the README. Archive-extraction code shipping a
traversal payload as a string literal is a reasonable thing for a
supply-chain scanner to refuse; the strings that made it look like an
exploit kit were the description of how it refuses exploits.

So the prose now describes the behaviour in words — "a name that climbs out
of the destination", "expands far past what it declares" — and the `zip.ts`
helper is `overExpandedMessage` rather than `bombMessage`.

**No behaviour changes.** The refusals are identical and the tests that
exercise them are untouched, still using real hostile inputs; they are not
published (`files: ["dist"]`), which is exactly why they can keep them.
