# Foundry production integration — release handoff

Verified on 9 September 2026 with Node 22.18. This is a **tested release candidate, not a published release or a guarantee for an untested production application**.

## Source and scope

- Candidate branch: `codex/foundry-production-release`, built on upstream `main` at `7f6b97b8`.
- The original `codex/glove-foundry-release` checkout and its dirty Hercules work were preserved. Do not publish that older checkout by mistake.
- Reconciles reusable Foundry work with upstream `glove-core` 4 and `glove-memory` 2, retaining native runtime context, tasks, facts/forms, voice and document surfaces.
- Excludes Hercules application updates. Includes durable Foundry instance/conversation data, SQLite structured memory, MCP lifecycle controls, tool approvals, steering, bounded programmatic tools, and multimodal conversation integration.
- Foundry now requires Station `^2.3.0`; the lockfile resolves the completed-child drain and cancellation escalation fixes in `station-env`, `station-signal`, and `station-schedules` 2.3.0.
- The Clack setup wizard adds project/target/template/package-manager choices, confirmation, optional installation, and non-interactive flags. Node 20.12+ is required; use Node 22.13+ for SQLite memory.
- The package README, both generated starter READMEs, handbook, website setup-and-CLI page, navigation, and machine-readable Foundry docs cover setup, commands, troubleshooting, and production boundaries.

The Glove Foundry and Glove skills guided integration against native primitives rather than introducing parallel memory, voice, or workspace systems.

## Verification evidence

| Surface | Result |
| --- | --- |
| Entire publish build graph | Passed, including ordered legacy Glovebox dependencies; no publishing command run |
| Foundry runtime suite | 80 passed, including real completed/cancelled worker process cleanup |
| New initializer and existing scaffold tests | 11 passed; terminal policy, flags, piped setup, invalid options, Next.js preservation, versions, and all four package-manager dispatch paths |
| Interactive terminal | Selected minimal starter and npm; confirmed generation; separately cancelled with Ctrl+C and verified no output directory |
| Packaged CLI | Packed tarball scaffolds a project; generated project type-checks against the tested workspace dependency closure |
| Real dependency installation | Initializer ran `pnpm install` to completion in a fresh minimal project; registry-installed project type-check passed and next steps correctly omitted reinstalling |
| Core / JS / Python / Lisp | 24 / 83 / 87 / 99 tests passed |
| Structured memory | 198 passed, including 10 SQLite durability/isolation/concurrency/corruption tests |
| MCP | 50 passed with deterministic recycling clock and serialized stdio integration tests |
| Native working environment / documents | 427 / 98 tests passed |
| Voice S2S / avatar / LiveKit | 48 / 16 / 10 tests passed; native, React and Next voice hosts type-checked |
| Facts | 23 tests passed |
| Canonical Foundry example | Type-check, architecture verifier, and end-to-end runtime verifier passed |
| Live Gemini integration | Real provider session invoked direction-recording and briefing tools and returned spoken confirmation |
| Documentation website | Production Next.js build passed, including setup page and Foundry machine-readable routes |
| Release metadata | Changeset preview, published-version preflight, frozen-lockfile install and whitespace checks passed |

The packed-consumer check uses the tested workspace dependency closure, not a fresh registry-only installation of unreleased packages. The live voice check does not certify a browser microphone, phone carrier, Discord/Telegram installation, or application-specific deployment. Those need acceptance testing with the eventual production application's adapters and credentials. Windows installation dispatch is implemented but was not exercised on this macOS host.

## Release procedure

1. Review and merge the candidate into `main`; let CI run on the merged result.
2. Review and merge the automated **Version Packages** PR. The pending changeset schedules minor releases for Foundry, core, memory, MCP and the three REPL packages.
3. Inspect the generated dependent bumps. The existing Changesets peer-dependency policy currently schedules a **major Scratchpad bump** because its optional MCP peer uses `workspace:*`, plus dependent patch bumps. This policy was not silently changed.
4. From a clean, updated checkout of the repository root, with npm release access configured, run `npx release`. The wrapper builds and publishes already-versioned packages; it does not apply pending changesets itself.
5. Verify published versions and install a new project from the registry. Exercise the production application's actual voice, documents, persistence, authorization and external integrations before rollout.

No npm publication, main-branch merge, or production deployment was performed. Current tarballs retain pre-release-bump manifest versions and are only local verification artifacts; do not manually publish them over existing versions.

## Day-one production configuration

- Keep credential acquisition and refresh in user-owned adapters. The initializer never asks for API keys.
- Separate durable Foundry instance/conversation data, agent memory, scheduler/runtime state, and working-environment VFS storage; persisting one does not persist the others. Starter storage is disposable demo storage.
- SQLite memory is opt-in and single-host. Select different adapters for distributed production requirements.
- Preserve loopback defaults unless a request-authorization adapter protects the control plane. Set bounded multimodal request limits for documents/media.
- Maintain application-specific health checks and a rollback plan. Successful framework tests cannot guarantee the behavior of an application that has not yet been provided.
