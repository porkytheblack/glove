# glove-env-archives

## 1.0.0

### Minor Changes

- [#47](https://github.com/porkytheblack/glove/pull/47) [`da6b249`](https://github.com/porkytheblack/glove/commit/da6b249a2c217f32a8add39d6e238ae4f4bc2e2e) Thanks [@porkytheblack](https://github.com/porkytheblack)! - New adapter: `glove-env-archives` — zip, tar and tar.gz inside the VFS.

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

- Updated dependencies [[`5e9c527`](https://github.com/porkytheblack/glove/commit/5e9c5279ed0381ba01c72f4ef15d1fb88ea53cd0), [`fa1b473`](https://github.com/porkytheblack/glove/commit/fa1b47358a9f030f0b36061340d870858d5a17bf), [`6d95d17`](https://github.com/porkytheblack/glove/commit/6d95d17078521ccb5e02a72c34f8d4de91c8092b), [`281fd23`](https://github.com/porkytheblack/glove/commit/281fd230eae3a26224b84f17d465b6a3e9f96868), [`f2e13ef`](https://github.com/porkytheblack/glove/commit/f2e13ef7dffa37649b6c4efc2e2ad4d1d3500128), [`e49bf99`](https://github.com/porkytheblack/glove/commit/e49bf994260336c4f689a709e6c32494f1643df2), [`da6b249`](https://github.com/porkytheblack/glove/commit/da6b249a2c217f32a8add39d6e238ae4f4bc2e2e), [`fc3cd2b`](https://github.com/porkytheblack/glove/commit/fc3cd2b83fe5adc7dfbb4ef1d1ddf533d2769988), [`b57dfca`](https://github.com/porkytheblack/glove/commit/b57dfcac6454aceb33684bf6edc0cf7fd4708361), [`53d9c66`](https://github.com/porkytheblack/glove/commit/53d9c66e0e950fe4d69a5e5526125a94428a8b80), [`568a250`](https://github.com/porkytheblack/glove/commit/568a2506ff1ccd280347ed5d5cc3698748b378f1), [`8fcfea7`](https://github.com/porkytheblack/glove/commit/8fcfea7baececdc85a7b144b55caf2e91ce8049d), [`f003e59`](https://github.com/porkytheblack/glove/commit/f003e591b2d0cae6608358c3e2c6e1a58bbb1e63), [`49f6e3a`](https://github.com/porkytheblack/glove/commit/49f6e3a27cf2122c51c1e32e9951ea12a12b01c3), [`1d6650a`](https://github.com/porkytheblack/glove/commit/1d6650a61257658f9e2276ce5238e50fd893dd34), [`7ed19c3`](https://github.com/porkytheblack/glove/commit/7ed19c3521da4043147e8abb29326e2a2233b61c), [`ae34ca1`](https://github.com/porkytheblack/glove/commit/ae34ca1c56eaa65502afe3c6595d671bbc704860)]:
  - glove-working-environment@0.2.0
