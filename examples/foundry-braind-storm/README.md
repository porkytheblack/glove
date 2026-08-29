# Braind Storm

An agentic brand workforce built on Glove Foundry. You speak with Mara, the lead. She convenes four opinionated peers over Glove Mesh:

- Iris Signal — culture and market scout
- Theo North — positioning and go-to-market strategist
- Noor Static — creative director with Glove Image
- Vera Proof — multimodal brand critic

Every storm gets one persistent, sandboxed Glove working environment. The team passes `/out/...` paths over the mesh, produces Markdown and Word documents, generates key art through the first-party Gemini image adapter, and visually reviews the result. Agent definitions stay compositional; the runtime assembles mesh, skills, documents, image tools, and workspace state for the current message.

The page includes a live workforce observatory backed by Foundry's correlated SSE event stream. It shows which agent is active, the current work intent and visible outcome, progress through the storm, Glove Mesh handoffs, shared artifact paths, tool activity, assembly events, and the complete run lifecycle. These are operational traces and concise work summaries—not private model chain-of-thought.

Mara also has a Gemini Live briefing line. **Call Mara** opens a full-duplex speech-to-speech Foundry agent against the current storm. She can read the latest recommendation and shared artifacts with `get_storm_briefing`, persist spoken corrections and decisions with `record_direction`, or start real work with `launch_campaign_workforce`. Voice direction lands under `/inbox/voice` and is injected as first-party input when the workforce next convenes.

One call can launch up to eight campaigns. `parallel` starts independent campaign workforces together, `sequential` completes them in input order, and `auto` compiles `dependsOn` relationships into execution waves—independent campaigns share a wave while dependent work waits. Each campaign gets an isolated Foundry conversation and Glove working environment. The call returns immediately with a durable batch run id; the new **Campaign Control** rail shows every batch and lets you switch the observatory onto any child workforce run.

## Run it

```bash
cp .env.example .env
# add GEMINI_API_KEY to .env
pnpm --filter glove-foundry-braind-storm dev
```

Open [http://localhost:3003](http://localhost:3003). Foundry runs on `127.0.0.1:4260`.

Optional model overrides:

```bash
export BRAIND_TEXT_MODEL=gemini-3.5-flash-lite
export BRAIND_IMAGE_MODEL=gemini-3.1-flash-image
export S2S_MODEL=models/gemini-3.1-flash-live-preview
export BRAIND_VOICE=Kore
```

The live line allocates local rooms from ports `4761–4766` by default. Override `BRAIND_CALL_BASE_PORT`, `BRAIND_CALL_SLOTS`, or `NEXT_PUBLIC_BRAIND_CALL_HOST` when the browser reaches Foundry through a different host.

Foundry and its image adapter only read credentials supplied by the host. They do not acquire, refresh, or select account credentials.

## Provider pressure

Concurrent campaigns share a host-owned, cross-process Gemini admission gate. By default, only one Gemini text or image request enters at a time and the next request waits eight seconds after the preceding call. After a model-specific 429, the pass moves to the host-configured reserve model before continuing its retry schedule. HTTP 429 and transient 5xx responses use provider `Retry-After` metadata when available, otherwise a bounded exponential schedule with five attempts. Waiting work keeps its completed `/out` artifacts and emits an explicit queued or scheduled-retry event in Campaign Control.

Tune this without changing agent definitions:

```bash
BRAIND_GEMINI_MIN_INTERVAL_MS=8000
BRAIND_GEMINI_STALE_LEASE_MS=330000
BRAIND_MODEL_MAX_ATTEMPTS=5
BRAIND_TEXT_FALLBACK_MODELS=gemini-3.1-flash-lite
```

This handles burst and rolling-window pressure. A genuinely exhausted daily quota or disabled billing remains a host/provider issue and eventually fails with an explicit terminal event instead of retrying forever.

## Skill packs

The UI can attach job-function packs from [Anthropic's knowledge-work plugin collection](https://github.com/anthropics/knowledge-work-plugins). `SkillSourceAdapter` loads only `skills/*/SKILL.md` knowledge into the working environment. It deliberately does not activate the source repository's MCP catalogue or connectors. Replace that adapter to use a pinned mirror, database, signed bundle, or organization-specific skill registry.

## Verify

```bash
pnpm --filter glove-foundry-braind-storm typecheck
pnpm --filter glove-foundry-braind-storm verify
pnpm --filter glove-foundry-braind-storm verify:call
# with `pnpm dev` already running:
pnpm --filter glove-foundry-braind-storm verify:room
pnpm --filter glove-foundry-braind-storm verify:campaign-call
pnpm --filter glove-foundry-braind-storm verify:live
pnpm --filter glove-foundry-braind-storm build
```

The offline check also assembles the S2S model and proves that voice direction is path-safe and durable. The live check creates a real multi-agent storm, Gemini key art, a visual critique, and a `.docx` brand system under `.braind-storm/workspaces/`.
