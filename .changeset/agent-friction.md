---
"glove-working-environment": patch
"glove-env-documents": patch
---

Fix the three things real agents actually tripped over.

Four models were run through four end-to-end deliverable scenarios via OpenRouter (`benches/working-environment-bench`). Of 38 errored tool calls, three classes accounted for 16 of them — and none was a crash. They were messages that sent the model the wrong way.

**Running a script that does not exist reported `no such module`.** That is the *import resolver's* error, surfacing on a verb the model called with a path, so it reads as a dependency problem rather than "you have not written this yet". It now says `no such script: /scripts/x.js` and lists the scripts that do exist — or that `/scripts` is empty and to `write_file` first. Directories and non-`.js` targets are refused in their own terms too.

**Running or importing anything under `/std` was incoherent.** Models read `/std/documents/index.d.ts` and then reach for that *path* — reasonably, since every verb in the surface takes an absolute path. Running it tried to evaluate a `.d.ts` as a module (`could not parse export statement`, from a file the model had just been told to read as documentation); importing it reported a missing file. Both now say that `/std` holds documentation and name the specifier to use instead — and the import case is caught at *write* time, so the script is never stored.

**`readdir` returns entry objects; Node's returns strings.** Every `f.endsWith is not a function` in the run came from `entries.filter(f => f.endsWith('.png'))`. The `env:fs` types now say so at the point of use and point at `glob()`, which returns full paths and filters in one step.

Also silences pdfjs, which narrated font substitution to stderr on every `extractText` call. Pointing it at the bundled fonts made it worse — pdfjs 5 ships Foxit faces but asks for Liberation ones — so verbosity is set to errors-only. Real failures still throw.

The remaining friction class, models guessing binding names (`csv.parseRows`, `readFile is not defined`), is filed rather than fixed: the runtime knows what is available and could say so, but doing it through a `Proxy` has to happen inside the vm context or it reopens the realm leak the sandbox tests exist to catch.
