---
"glove-react": patch
---

History hydration skips saved runtime context and delivered events, so they do not show as user messages: `framework_context` `"runtime"` or `"event"`, or, for stores that drop that field, text matching Glove's complete `<context key>` or `<events>` wrapper (a user message that merely starts with the same tag stays visible). A final model answer is flushed into the timeline when it completes, so a turn an event started shows its reply. `requiresPermission` on `defineTool` and tool types accepts async predicates.
