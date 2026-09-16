---
"glove-memory": minor
---

Add opt-in skippable form fields, reasoned skip revisions, and `glove_form_revise` action `skip`. Skips settle completion without fabricated values, persist through undo/redo and SQLite restarts, and are protected from automatic preparation. Add durable `onSkip` effects with the normal executor context and skip reason. Expose skip policy and reasons in form views, history, and runtime context, with skippable values inferred as possibly undefined.
