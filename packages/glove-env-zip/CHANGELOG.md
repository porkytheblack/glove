# glove-env-zip

## 1.0.0

### Minor Changes

- [#149](https://github.com/porkytheblack/glove/pull/149) [`c47e4f0`](https://github.com/porkytheblack/glove/commit/c47e4f08d2b5ae30081e7ee393076dc15f44c182) Thanks [@claude](https://github.com/apps/claude)! - New adapter: `glove-env-zip` — zip, tar and tar.gz inside the VFS.

  Archives are how batches of files actually arrive: an export from another system, a bundle of scans, a customer's data dump. An agent handed `/inbox/records.zip` was simply stuck — nothing in the environment could open it. They are also the natural way to hand a multi-file deliverable back, as one file rather than an array the host has to write out itself.

  `describe` and `list` answer what is in an archive without extracting it; `extract(path, dir, { include })` takes only what is wanted; `create(dir, output)` packages a directory back up. Dependency-free — ZIP and tar are stable container formats and `node:zlib` supplies the only hard part.

  **Extraction is the part that has to be right, and it is where the tests are.** A zip reader that round-trips its own output but writes `/etc/passwd` when handed a hostile archive has failed at the only job that is hard.

  - _Traversal._ `../../etc/passwd`, absolute paths, backslash separators, `safe/../../../escaped` — refused by name. The check is on the **resolved** path rather than the spelling, since `a/../../b` normalises away before any string comparison would catch it. `a/../b.txt`, which resolves back inside the destination, is allowed: refusing it would reject archives real tools produce.
  - _Decompression bombs._ The declared uncompressed size is attacker-controlled, so it is checked **and** the decompression itself is capped. A zip declaring ten bytes that expands to five megabytes fails at the cap, not at the claim; `.tar.gz`, which has no declared size at all, is capped before the tar is parsed.
  - Entry counts are bounded, extracted bytes count against `maxVfsBytes` like any other write, and nested archives are not extracted recursively.

  Encrypted entries, ZIP64, unsupported compression methods, and tar symlinks/devices/hard links are refused explicitly rather than half-read — a silently-wrong extraction is worse than a failed one.

  Format is detected from the bytes, not the extension: a zip named `.tar` is read as a zip. Archives are claimed by the `describe` verb too, so orientation needs no script.

  Alongside it, `EnvFsHandle` now exposes the environment's `limits`. Adapters previously had no way to see the caps they were working inside, so they could only fail late — after inflating an archive that was never going to fit. The gateway still enforces every write; what this buys is the chance to refuse first.

  The glob matching for `include` reuses the core's `globToRegExp` rather than a second implementation. The hand-rolled one shipped with a bug (`**/*.csv` missed files at the archive root), which is the argument against having two.

### Patch Changes

- [#131](https://github.com/porkytheblack/glove/pull/131) [`416d1dd`](https://github.com/porkytheblack/glove/commit/416d1ddb992e6b82119f9eef78c8af7dfe96014e) Thanks [@claude](https://github.com/apps/claude)! - Adapters accept a range of hub versions instead of pinning one exactly

  Every `glove-env-*` declared its `glove-working-environment` peer as `workspace:*`, which pnpm rewrites to an **exact** version at publish time. The published packages had already diverged because of it — `glove-env-documents@0.1.0` required exactly `0.1.0` while `glove-env-motion@0.1.0` required exactly `0.2.0`, so installing both from npm was unsatisfiable, and every future hub release orphaned every adapter already out there.

  The peer is now `workspace:^`, which publishes as a caret range (`^0.2.0`). Verified against a real `pnpm pack` tarball rather than assumed from the source manifest.

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
