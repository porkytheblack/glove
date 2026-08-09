---
"glove-env-documents": patch
"glove-env-spreadsheets": patch
"glove-env-images": patch
"glove-env-slides": patch
"glove-env-archives": patch
"glove-env-media": patch
"glove-env-render": patch
"glove-env-motion": patch
---

Adapters accept a range of hub versions instead of pinning one exactly

Every `glove-env-*` declared its `glove-working-environment` peer as `workspace:*`, which pnpm rewrites to an **exact** version at publish time. The published packages had already diverged because of it — `glove-env-documents@0.1.0` required exactly `0.1.0` while `glove-env-motion@0.1.0` required exactly `0.2.0`, so installing both from npm was unsatisfiable, and every future hub release orphaned every adapter already out there.

The peer is now `workspace:^`, which publishes as a caret range (`^0.2.0`). Verified against a real `pnpm pack` tarball rather than assumed from the source manifest.
