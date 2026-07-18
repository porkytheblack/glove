---
"glove-js": minor
"glove-python": minor
"glove-lisp": minor
---

Eval-tool framing: choose `execute_*` vs `execute_*_program` vs `execute_*_workflow` at mount time. All three surfaces (`glove-js`, `glove-python`, `glove-lisp`) now take a `frame` option on the mount config and tool builders — `"repl"` (default, unchanged: `execute_js` / `execute_python` / `execute_lisp`), `"program"` (`execute_*_program`), or `"workflow"` (`execute_*_workflow`, plus `explain_lisp_workflow` for the Lisp explain companion). The runtime is identical across framings — only the tool NAME and the primed preamble change. The `workflow` framing actively de-REPLs the priming (author the WHOLE task as one program; cross-call persistence is demoted to a retry-only recovery aid) to counter models degrading the single-eval surface back into an incremental, line-by-line tool-call loop. New exports: `Frame` type, `jsToolName` / `pyToolName` / `lispToolName` / `lispExplainName`, `buildJsPreambleBody` / `buildPyPreambleBody` / `buildLispResourcePreamble` / `buildLispFnPreamble`, and `buildDiscoveryTools` (glove-js). Default is `repl`, so existing mounts are byte-for-byte unchanged. See `benches/scratchpad-bench/FRAME-PAPER.md` for the A/B benchmark, the discovery-mode contrast, and the revealed-preference (choice) study that motivated it.
