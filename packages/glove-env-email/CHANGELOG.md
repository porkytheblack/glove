# glove-env-email

## 1.0.0

### Minor Changes

- [#131](https://github.com/porkytheblack/glove/pull/131) [`a363ba1`](https://github.com/porkytheblack/glove/commit/a363ba1f37b392d1e679f2b97e5bcba7eac73913) Thanks [@claude](https://github.com/apps/claude)! - New adapter: `glove-env-email` — `.eml` and Outlook `.msg`, opened in place, with attachments written into the tree.

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

### Patch Changes

- [#150](https://github.com/porkytheblack/glove/pull/150) [`03548f1`](https://github.com/porkytheblack/glove/commit/03548f103ce442872d0626ffeefe5591d01ab284) Thanks [@claude](https://github.com/apps/claude)! - Describe the extraction defences without embedding attack payloads.

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

- Updated dependencies [[`5e9c527`](https://github.com/porkytheblack/glove/commit/5e9c5279ed0381ba01c72f4ef15d1fb88ea53cd0), [`fe2fd69`](https://github.com/porkytheblack/glove/commit/fe2fd6907dcaaea277859bb8ed4a06ddea3c459b), [`104478e`](https://github.com/porkytheblack/glove/commit/104478eb35b0fc2f43396b2b04afcc181fb81900), [`fa1b473`](https://github.com/porkytheblack/glove/commit/fa1b47358a9f030f0b36061340d870858d5a17bf), [`6d95d17`](https://github.com/porkytheblack/glove/commit/6d95d17078521ccb5e02a72c34f8d4de91c8092b), [`281fd23`](https://github.com/porkytheblack/glove/commit/281fd230eae3a26224b84f17d465b6a3e9f96868), [`f2e13ef`](https://github.com/porkytheblack/glove/commit/f2e13ef7dffa37649b6c4efc2e2ad4d1d3500128), [`4774ff3`](https://github.com/porkytheblack/glove/commit/4774ff3573167e5779e09e0d17238398546caaf5), [`e49bf99`](https://github.com/porkytheblack/glove/commit/e49bf994260336c4f689a709e6c32494f1643df2), [`4099b67`](https://github.com/porkytheblack/glove/commit/4099b671ca1ca9489cb12934859ea5d7c002e24d), [`fc3cd2b`](https://github.com/porkytheblack/glove/commit/fc3cd2b83fe5adc7dfbb4ef1d1ddf533d2769988), [`b57dfca`](https://github.com/porkytheblack/glove/commit/b57dfcac6454aceb33684bf6edc0cf7fd4708361), [`c47e4f0`](https://github.com/porkytheblack/glove/commit/c47e4f08d2b5ae30081e7ee393076dc15f44c182), [`f600236`](https://github.com/porkytheblack/glove/commit/f600236010a168040b9eb9b6cb0ff1b8f9c7608a), [`eeffd52`](https://github.com/porkytheblack/glove/commit/eeffd52a74666ca438d20bc2a48a7464c2ced38f), [`37d84f6`](https://github.com/porkytheblack/glove/commit/37d84f6289689e333a3cce4f5d9c8530c8640eb1), [`2d3e974`](https://github.com/porkytheblack/glove/commit/2d3e9741254c00d3561a32118a34d59fd97dfa10), [`bfbb73b`](https://github.com/porkytheblack/glove/commit/bfbb73bf3cc2ae4c9b2f3a714a920cfcb60232bb), [`eeffd52`](https://github.com/porkytheblack/glove/commit/eeffd52a74666ca438d20bc2a48a7464c2ced38f), [`e696111`](https://github.com/porkytheblack/glove/commit/e6961110574c9ff2117fa47d9f1c36ef9e4c85dc), [`53d9c66`](https://github.com/porkytheblack/glove/commit/53d9c66e0e950fe4d69a5e5526125a94428a8b80), [`701f4d9`](https://github.com/porkytheblack/glove/commit/701f4d9a7cd37aef314d0521793bd960cf985fe8), [`568a250`](https://github.com/porkytheblack/glove/commit/568a2506ff1ccd280347ed5d5cc3698748b378f1), [`8fcfea7`](https://github.com/porkytheblack/glove/commit/8fcfea7baececdc85a7b144b55caf2e91ce8049d), [`f003e59`](https://github.com/porkytheblack/glove/commit/f003e591b2d0cae6608358c3e2c6e1a58bbb1e63), [`49f6e3a`](https://github.com/porkytheblack/glove/commit/49f6e3a27cf2122c51c1e32e9951ea12a12b01c3), [`1d6650a`](https://github.com/porkytheblack/glove/commit/1d6650a61257658f9e2276ce5238e50fd893dd34), [`443e414`](https://github.com/porkytheblack/glove/commit/443e41424b47106228f8a1a8743871f146c484ad), [`d72834d`](https://github.com/porkytheblack/glove/commit/d72834d8819d37b95c16809bf7e0e646073f6948), [`8df9ee3`](https://github.com/porkytheblack/glove/commit/8df9ee3ef41bd2f1b7c1234ef379ef0704d5a765), [`7ed19c3`](https://github.com/porkytheblack/glove/commit/7ed19c3521da4043147e8abb29326e2a2233b61c), [`ae34ca1`](https://github.com/porkytheblack/glove/commit/ae34ca1c56eaa65502afe3c6595d671bbc704860), [`78ffe34`](https://github.com/porkytheblack/glove/commit/78ffe34bd8ccb304239a65f931635053b93d4e50)]:
  - glove-working-environment@0.6.0
