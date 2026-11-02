---
"glove-foundry": patch
---

Stopping Foundry no longer fails now and then with "execution daemon disconnected" (#208). Asked to stop, the background process closed its channel right after sending its reply, and the reply could be lost. It now closes the channel once the reply is written, and the host treats the process going away during a stop as stopped. When the process goes away unasked, the error names its exit code or signal, and the host's stderr gets the end of its output, with secret-looking values masked.
