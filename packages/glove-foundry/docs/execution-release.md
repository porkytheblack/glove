# Station 3 and execution mounts — release handoff

Verified on 23 September 2026 with Node 22.18 and pnpm 10.28.2. This is a source release candidate; package versions, npm publication and production documentation deployment have not been performed.

## What ships

- `glove-execution`: optional, adapter-backed browser and sandbox mounts. The default entrypoint is portable; Station adapters live under `glove-execution/station`. Mounts attach tools and transient screenshot context without taking or replacing the agent model.
- `glove-core`: runtime context providers accept native content parts alongside text. Browser and sandbox implementation dependencies remain outside core. Runtime-context telemetry omits media payloads and URLs.
- `glove-foundry`: agent jobs run in a managed local Station 3 daemon. Optional `stationDaemon` application configuration starts browser/sandbox providers in that same daemon. Generic mount cleanup handles success, failure and cancellation. Scheduled activation transitions are serialized so delayed daemon acknowledgements cannot overwrite a pause or cancellation.
- Foundry Operator: a general-purpose example with Steel proxy sessions, Docker sandboxes and server previews, native per-conversation memory, application-owned continuity/compaction prompts, and native Foundry sleep. Telegram is a user request, not a preloaded workflow.
- Existing Station room examples use Station 3's daemon and separate dashboard rather than the retired `station-kit` entrypoint.

The execution changeset proposes `glove-core` 4.2.0, `glove-foundry` 0.5.0 and the initial `glove-execution` 0.2.0 publication. Other pending changesets and dependent-package version bumps remain part of the repository's release plan. Inspect Changesets' complete plan before publishing; do not publish the current pre-versioning tarballs over existing registry versions.

## Documentation and illustrations

- [Execution architecture and migration](./execution.md)
- [Package guide](../../glove-execution/README.md)
- [Operator setup and verification](../../../examples/foundry-operator/README.md)
- Site guide: `/docs/execution`
- Illustrated walkthrough: `/foundry/docs/browser-and-sandbox`
- Blog: `/blog/agents-with-browsers-and-sandboxes`
- Updated package catalog, Foundry landing page, documentation navigation and repository agent skills.
- Both `/llms.txt` and `/llms-full.txt`, and both `/foundry/llms.txt` and `/foundry/llms-full.txt`, include the new package and shared Station configuration. The full references include the Operator documentation once, including ownership and lifecycle limits.

The family diagram explains core, Foundry, mounts and adapters. The architecture diagram shows jobs and optional resources sharing one Station daemon. Public demo screenshots illustrate browser scripting and a sandbox-hosted server without exposing credentials or private conversations.

## Verification

The repository's complete publish build graph (legacy dependency first), package typechecks and site production build passed. The affected suites passed: core 25, execution 11 (one separately verified real-browser integration is opt-in), Foundry 97 and Operator 5. Delayed-acknowledgement regressions exercise pause and cancel while a real daemon run is already visible; existing tests cover updates, recurrence, overdue reconstruction and resumption.

Additional checks cover:

- Registry version preflight and the complete Changesets version plan.
- Tarball contents, declared export/type targets, daemon/loader entrypoints, packaged imports and CLI scaffolding using the tested workspace dependency closure. This is not a fresh registry install of unpublished versions.
- Desktop and mobile views of both guides, the blog, package catalog, Foundry landing page and blog index: no JavaScript errors, horizontal overflow or broken images.
- HTTP 200 responses and new API coverage in all four LLM reference endpoints.
- Real Chromium integration, and a live Operator run creating a proxied Steel browser, reading a public page, taking a screenshot, closing the browser and checking an existing Docker-hosted server over HTTP.
- An earlier isolated memory verifier checked compaction and recall. Memory is per agent conversation by default; cross-conversation retrieval and continuity policy belong to the application.

Telegram authentication is **not verified**: its login page remained on a loading state and no QR login completed. Public browser and sandbox verification must not be represented as successful Telegram account control.

## Operational boundaries

Foundry owns the managed local daemon process. Its current job queue is in memory; interrupted live jobs are not restored after process loss. Durable conversation, activation and memory adapters have their own persistence behavior. This release does not add distributed execution or high availability.

Application resource factories run once per daemon and must release partially acquired resources if they throw before returning. Foundry closes returned providers on shutdown and startup failure. Retention across turns is an explicit adapter/application policy; choose scope identities, resource grants, credentials and expiration accordingly.

The private `onReady` connection has Station 3 operator/admin authority. Keep it in trusted host code, never in model context or public UI responses. Steel proxy configuration is an application/provider setting, and still depends on account availability. Foundry requires Node 22+; the portable mount entrypoint does not acquire that requirement.

## Release procedure

1. Review and merge the implementation, docs and changesets together.
2. Use the repository's Version Packages workflow/PR to apply the complete version plan and refresh the lockfile. Review dependent-package bumps and first-publication metadata.
3. Run release preflight and affected validation on that versioned candidate. The locally inspected pre-versioning tarballs are verification artifacts only.
4. Publish through the repository's maintainer release workflow, then verify the published exports and a clean consumer installation.
5. Deploy the site and verify the new guide, blog, diagrams and four LLM endpoints at their production URLs.
