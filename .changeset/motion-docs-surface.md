---
"glove-working-environment": patch
---

README: list `env:render` and pair `env:motion` with `MOTION_LIMITS`

The adapter table had a gap — `glove-env-render` was missing from it despite being the module the `view_image` verb depends on. The `env:motion` row now also names `MOTION_LIMITS`, since mounting the adapter without raising `runTimeoutMs` means every render is refused up front.
