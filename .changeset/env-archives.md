---
"glove-env-archives": minor
"glove-working-environment": patch
---

New adapter: `glove-env-archives` — zip, tar and tar.gz inside the VFS.

Archives are how batches of files actually arrive: an export from another system, a bundle of scans, a customer's data dump. An agent handed `/inbox/records.zip` was simply stuck — nothing in the environment could open it. They are also the natural way to hand a multi-file deliverable back, as one file rather than an array the host has to write out itself.

`describe` and `list` answer what is in an archive without extracting it; `extract(path, dir, { include })` takes only what is wanted; `create(dir, output)` packages a directory back up. Dependency-free — ZIP and tar are stable container formats and `node:zlib` supplies the only hard part.

**Extraction is the part that has to be right, and it is where the tests are.** A zip reader that round-trips its own output but writes `/etc/passwd` when handed a hostile archive has failed at the only job that is hard.

- *Traversal.* `../../etc/passwd`, absolute paths, backslash separators, `safe/../../../escaped` — refused by name. The check is on the **resolved** path rather than the spelling, since `a/../../b` normalises away before any string comparison would catch it. `a/../b.txt`, which resolves back inside the destination, is allowed: refusing it would reject archives real tools produce.
- *Decompression bombs.* The declared uncompressed size is attacker-controlled, so it is checked **and** the decompression itself is capped. A zip declaring ten bytes that expands to five megabytes fails at the cap, not at the claim; `.tar.gz`, which has no declared size at all, is capped before the tar is parsed.
- Entry counts are bounded, extracted bytes count against `maxVfsBytes` like any other write, and nested archives are not extracted recursively.

Encrypted entries, ZIP64, unsupported compression methods, and tar symlinks/devices/hard links are refused explicitly rather than half-read — a silently-wrong extraction is worse than a failed one.

Format is detected from the bytes, not the extension: a zip named `.tar` is read as a zip. Archives are claimed by the `describe` verb too, so orientation needs no script.

Alongside it, `EnvFsHandle` now exposes the environment's `limits`. Adapters previously had no way to see the caps they were working inside, so they could only fail late — after inflating an archive that was never going to fit. The gateway still enforces every write; what this buys is the chance to refuse first.

The glob matching for `include` reuses the core's `globToRegExp` rather than a second implementation. The hand-rolled one shipped with a bug (`**/*.csv` missed files at the archive root), which is the argument against having two.
