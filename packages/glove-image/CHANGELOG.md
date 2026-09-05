# glove-image

## 0.2.0

### Minor Changes

- [#157](https://github.com/porkytheblack/glove/pull/157) [`3dad3ab`](https://github.com/porkytheblack/glove/commit/3dad3ab965ef4dff1973fa7339a60ae8f24b90e8) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Introduce Glove Foundry, the Effect-native, file-routed framework for typed and observable agent applications.

  - Publish the first `glove-foundry` release with composable code definitions, persisted instances, context-aware lazy assembly, applications and transmissions, dynamic playbooks and schedules, conversations, agent working environments, multi-agent composition, and the Foundry inspection workbench.
  - Add Gemini native image generation and editing to `glove-image`.
  - Refresh the Gemini model catalogue in `glove-core`.
  - Move Gemini Live runtime text onto the realtime input protocol and update its default live model.
  - Deprecate the Glovebox package family in favor of Glove Foundry. Existing Glovebox deployments remain supported as a legacy compatibility surface, while new agent runtimes should use Foundry.

### Patch Changes

- [#166](https://github.com/porkytheblack/glove/pull/166) [`ee591da`](https://github.com/porkytheblack/glove/commit/ee591da42305661339913bca8f967a9f8c0fecbf) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Support OpenRouter-native video content in model requests and preserve fitted image dimensions in OpenRouter image generation, enabling identity-aware video generation and review workflows.

- Updated dependencies [[`3dad3ab`](https://github.com/porkytheblack/glove/commit/3dad3ab965ef4dff1973fa7339a60ae8f24b90e8), [`ee591da`](https://github.com/porkytheblack/glove/commit/ee591da42305661339913bca8f967a9f8c0fecbf)]:
  - glove-core@3.7.0

## 0.1.1

### Patch Changes

- Updated dependencies [[`f600236`](https://github.com/porkytheblack/glove/commit/f600236010a168040b9eb9b6cb0ff1b8f9c7608a), [`bfbb73b`](https://github.com/porkytheblack/glove/commit/bfbb73bf3cc2ae4c9b2f3a714a920cfcb60232bb), [`ef623ec`](https://github.com/porkytheblack/glove/commit/ef623ec744118723a6b45f6166274316e86a9109), [`443e414`](https://github.com/porkytheblack/glove/commit/443e41424b47106228f8a1a8743871f146c484ad)]:
  - glove-core@3.6.0
