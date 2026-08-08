---
"glove-env-motion": patch
---

Scenes can use images from anywhere in the tree, and say so when they cannot

`<img src="/inbox/bag.webp" />` — an uploaded photo, the most obvious thing to put in a video — rendered as an empty box. The page is a `file://` URL, so an absolute src resolved against the real filesystem root and found nothing. Only assets sitting *beside* the scene were staged. The render succeeded, the file was valid, the warnings array was empty, and the missing product was visible only by looking at the frame.

Assets named by absolute VFS path are now staged next to the page and the reference rewritten to reach them, so any path in the tree works. A path that is not in the tree becomes a warning naming it, and — as a backstop for anything path rewriting cannot see — the renderer asks the page which images it failed to decode and warns for each. A picture that did not load can no longer pass silently.

**`still` accepts a frame index sent as a string.** Script arguments are JSON a model wrote, where `"78"` and `78` are the same intent. Rejecting the string was defensible; reporting it as `got 78` was not — the message then stated a rule the printed value satisfied, which reads as a broken validator. It now coerces, and a genuine mistake reports the type: `got "later" (string)`.

**`interpolate` checks its easing.** `Easing.out(Easing.cubic)` is the shape other libraries use; here it evaluates a curve *at* a function, yields `NaN`, and surfaced as `easing is not a function` thrown from inside the runtime — naming neither the scene nor the option. It now says which option was wrong and what the right form is.
