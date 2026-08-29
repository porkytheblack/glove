---
"glove-foundry": minor
"glove-image": minor
"glove-core": minor
"glove-voice-s2s": patch
"glovebox-core": patch
"glovebox-kit": patch
"glovebox-client": patch
---

Introduce Glove Foundry, the Effect-native, file-routed framework for typed and observable agent applications.

- Publish the first `glove-foundry` release with composable code definitions, persisted instances, context-aware lazy assembly, applications and transmissions, dynamic playbooks and schedules, conversations, agent working environments, multi-agent composition, and the Foundry inspection workbench.
- Add Gemini native image generation and editing to `glove-image`.
- Refresh the Gemini model catalogue in `glove-core`.
- Move Gemini Live runtime text onto the realtime input protocol and update its default live model.
- Deprecate the Glovebox package family in favor of Glove Foundry. Existing Glovebox deployments remain supported as a legacy compatibility surface, while new agent runtimes should use Foundry.
