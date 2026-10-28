---
"glove-react": patch
---

History hydration skips saved runtime context and delivered events (`framework_context` `"runtime"` or `"event"`, or text that starts with `<context key="` or `<events note="`), so they do not show as user messages.
