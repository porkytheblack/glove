---
"glove-memory": patch
"glove-image": patch
---

README corrections. `glove-memory`: `useFormRunner` registers a runtime context provider that appends the form's status line at the model-input tail before every model call (`injectStatus: false` turns it off), and wraps `processRequest` only when `preparation` is configured. `glove-image`: remove references to the retired Glovebox runtime.
