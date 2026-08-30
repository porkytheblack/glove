---
"glove-foundry": patch
---

Rework the Foundry inspector around the questions an operator actually asks of a run.

- Live events are coalesced into one refresh instead of repainting the page per event, and a refresh now preserves scroll position, expanded events, open output panels, and the text and caret in a filter box. Previously any runtime event wiped what you were typing.
- Runs carry a duration and a relative start time that tick every second, so an in-flight run reads as in-flight without a reload.
- Run filters live in the query string. `/runs?status=failed&q=invoice` is a link you can send, and the status tabs carry live counts.
- A failed run states its error above the spine rather than only inside the recorded output; the event trace adds per-event offsets from the start of the run, category filters, and payload copy.
- Every truncated identifier has a copy button, lists take `j`/`k`/`Enter`, `/` focuses the run filter, `c` opens the run drawer, and `Command-Enter` submits it.
- Drop the webfont import the server's own content security policy has always blocked, which removes a guaranteed console error on every page load.
