---
"glove-env-motion": patch
---

A scene that throws fails in a second, and says what threw

A render whose scene threw during its first render used to wait out the whole mount timeout — **measured at 188s against the 180s default** — and then report only `the scene never mounted within 180000ms`. The browser's own error had been captured within milliseconds and was sitting one line below, in a field a caller is free to ignore. An agent hitting this retried five times.

Two causes, both fixed. The renderer now rejects the moment an uncaught page error arrives rather than waiting for a mount that cannot happen, and the error is recorded as well as signalled — most scene errors throw during navigation, before anything is listening, so signalling alone dropped exactly the common case. The message now leads with `the scene threw while rendering, so it never mounted`, carries the browser's error, and says plainly that it is the scene's fault rather than the renderer's.

Measured after: **188s → 0.9s** for a bad easing name, **0.4s** for a plain `throw`.

**`Easing` also grew up**, because the case that surfaced this was a scene reaching for `Easing.bezier` — which did not exist, so it threw `is not a function` from inside the runtime and pointed at the wrong file. It now carries `linear`, `in`, `out`, `inOut` (aliased `ease` / `easeIn` / `easeOut` / `easeInOut`), `quad`, `cubic`, `sin`, `expo`, `circle`, `back`, `bounce`, and a real `bezier(x1, y1, x2, y2)`. An unknown name now throws `Easing.elastic does not exist. Available: …` instead of `undefined`.
