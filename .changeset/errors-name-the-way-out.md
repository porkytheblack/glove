---
"glove-core": patch
"glove-working-environment": patch
---

Two dead-end errors now name the way out

**An unknown tool name lists the real ones.** `No tool called ask_user exists.` was the whole message. A model that guessed a plausible name had nothing to correct towards, and the observed behaviour was three identical guesses before abandoning the capability. It now adds a near-match suggestion where the names overlap, and the list of tools that do exist.

**A script's syntax error says where it is.** `syntax error: Unexpected identifier 'the'` sent the author searching a file for a common word. V8 puts the line, the source and a caret in the stack rather than the message; those three lines are now included, so an unterminated comment is visible instead of deduced.
