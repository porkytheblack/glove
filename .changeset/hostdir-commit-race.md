---
"glove-working-environment": patch
---

`hostDirectory.commit()` no longer destroys writes that land while it is running.

`commit()` is a sequence of awaited disk operations, and the environment keeps accepting writes throughout — a host calls it on a Save button while a `run_script` is still writing `/out`. Clearing the whole overlay at the end discarded every write that arrived during the commit: accepted by the environment, version-recorded, reported to the model as successful, then gone from disk and from the VFS view alike with no error anywhere. Entries are now cleared only if they are still the ones the commit wrote.
