# Framework context as a distinct message kind

Research note for later implementation. No provider-role redesign has been implemented. The release correction now adds optional framework provenance and fixes the concrete regressions below; the broader model-input type proposal remains future work.

## Recommendation

Represent framework context explicitly inside Glove, with source/provenance separate from the model provider's message role. Lower it through each adapter using supported roles and structured content. Do not send a made-up `context` role to every provider, and do not automatically promote stored facts or user-authored goals into system/developer instructions.

Two concepts need to remain separate:

- **Origin:** the framework supplied this snapshot; the human did not say it.
- **Authority:** state/evidence versus trusted application instructions.

An internal context kind can make tracing and UI attribution accurate. A labelled user-content fallback can explain origin to the model, but it does not create a provider-enforced authority level.

## Current implementation

`Message.sender` in `packages/glove/src/core.ts` permits only `user` and `agent`. `Glove.getRuntimeContext()` in `packages/glove/src/glove.ts` awaits registered callbacks and creates user-role messages. The agent loop appends them before each model call, after stored history and completed tool results. Snapshots are transient; adapters retain authoritative memory state.

Most text adapters map anything other than `agent` to the provider's user role. Merely adding another sender value would therefore be insufficient: every formatter must deliberately handle it. Realtime voice currently joins snapshot text and passes it through `injectText`, losing structured provenance at that boundary.

## Reproduced defects in the current path

These were reproduced before the corrective patch. The current patch addresses them with optional `framework_context` provenance, a real-user summary boundary, safe reminder placement, and structured content merging. The broader provider-role design remains separate.

**Historical attribution:** both underlying code paths predate this session. Adjacent-user merging with `String(content)` was already in the OpenAI-compatible/OpenRouter code in February 2026 and in MiMo when it was added in May. The last-user boundary for tool-result summaries dates to May 2026. This session's new user-role runtime snapshots now trigger those older behaviors in the memory path. Neither reproduction required conversation compaction. The summary issue requires tool-result summarization to be enabled and a result to have a summary. “Snapshot” here means the text returned by a runtime-context provider, not a compaction summary.

### Media can be lost during adjacent-user merging

The OpenAI-compatible, OpenRouter, and MiMo formatters merge adjacent user messages with `String(content)` when their content is an array. A user image followed by a runtime snapshot therefore creates a string containing `[object Object]`, losing the structured media payload.

Reproduction against the actual exported OpenAI-compatible formatter confirmed this with a two-part text/image message followed by a snapshot. Relevant code: `packages/glove/src/models/openai-compat.ts`, `openrouter.ts`, and `mimo.ts`.

A minimal correction should concatenate content blocks without flattening media, with regression tests against serialized adapter requests. Keeping text-only behavior consistent is useful, but preserving structure is mandatory.

### Snapshots shift the tool-summary boundary

`PromptMachine.summarizeOlderToolResults()` finds the last user message without tool results. A runtime snapshot satisfies that condition, making current-turn tool results appear older than the last user request. With tool-result summarization enabled, full current-turn data can be replaced with its summary prematurely.

A reproduction confirmed that the same current-turn tool result retained its full data without a snapshot and became its summary when a snapshot was appended.

A minimal correction can keep snapshots outside conversational turn-boundary calculation, without committing to the broader role redesign. Validate that genuine later user requests still allow older-result summarization.

## Related pre-existing inbox issue

Pending blocking-inbox reminders use the user role and are inserted immediately before the final history message on every loop iteration. A reproduction with two tool rounds under one real user request showed that the reminder makes the first round eligible for summary while leaving the newest result full. This placement existed before the runtime-provider work (present in the May 2026 inbox implementation). Resolved-inbox messages are appended before the incoming real user request, so that path does not create the same extra current-turn boundary.

The pending reminder also sits between the latest assistant tool call and its result after a tool round. Provider-level tests should cover that adjacency; the eventual correction should preserve complete call/result bundles. Distinct provenance and a real conversational-turn boundary would address the shared summary issue across memory snapshots and inbox reminders.

## Proposed internal contract

Prefer a transient `RuntimeContextMessage` distinct from persisted `Message`:

- A discriminator identifying runtime context.
- Text plus a stable source identifier.
- Provenance identifying framework delivery and the underlying source.
- An explicit distinction between state/evidence and trusted application instructions.
- No tool calls/results, assistant reasoning, or conversation-storage semantics.

Widen the model-input type and runtime-context getter/event to accept these messages, rather than automatically widening every storage interface. This avoids requiring a database migration for transient snapshots. It does require a documented migration for custom model adapters and external runtimes.

Wrappers must preserve provenance. Subscribers and transcript UIs should display a framework/context entry rather than user speech. A native provider role, when supported, is an adapter decision; Glove's internal origin should remain consistent across providers.

## Provider mapping constraints

| Provider API | Available approach | Important constraint |
|---|---|---|
| OpenAI Chat | Supported models accept developer/system messages; participant names can distinguish same-role speakers. | Participant names do not create authority. Generic OpenAI compatibility does not prove every backend supports a late developer message. |
| OpenAI Responses | User/assistant/system/developer messages; separate correlated function-call-output items. | Preserve required reasoning items and call/output correlation during continuation. |
| Anthropic Messages | Some newer models support mid-conversation system messages. | Model-gated; placement and tool-continuation rules matter. It is not a universal baseline capability. |
| Bedrock Converse | Current schema includes system, with model-specific feature support. | Check the exact endpoint/model; a schema enum does not guarantee universal support. |
| Gemini generateContent | User/model contents, with separate system instructions. | A labelled user content block is the portable tail fallback; no arbitrary context role. |
| OpenRouter / MiMo | Documented formats include developer/system roles. | Backend/model support, reasoning preservation, and actual late-message behavior need contract tests. |
| OpenAI Realtime | System/user/assistant conversation items can append without rewriting session instructions. | Use system only for explicitly trusted application guidance; memory data should not gain authority automatically. |
| Gemini Live | Setup system instructions, client content, and a separate tool-response channel. | Silent/no-response does not guarantee no interruption. Do not assume OpenAI Realtime semantics. |

Keep context after a complete tool-result bundle. Never fabricate a tool call simply to obtain a tool-result role. Anthropic additionally requires result blocks first in the following user turn; some pending server-tool continuations require a result-only message. Mapping needs to recognize those cases explicitly.

## Caching and voice

Preserve the initial system instructions and stable serialized history prefix. Test the actual wire payload: adapter merging and provider cache-breakpoint placement can alter it even when the internal message array looks stable. Prefix stability is not a guarantee of cache hits or billing.

Voice needs a context-specific adapter operation, or equivalent metadata-preserving input. Verify session ordering, interrupted turns, parallel tools, deduplication, and clearing old state per provider. Existing injected snapshots may remain in provider session history even when superseded semantically.

## Acceptance checks for a future implementation

1. Context retains origin in tracing and transcript rendering without becoming user speech.
2. Text/image/video content remains structured after context insertion and adapter normalization.
3. Multiple tool calls have matching complete results before appended context.
4. Current-turn full tool results remain intact with summarization enabled.
5. Runtime context never enters persisted conversation history or its compaction summary.
6. Provider capability checks choose valid role mappings and documented fallbacks.
7. Reasoning/tool continuation data survives the new normalization path.
8. Changing snapshots preserves the stable serialized system/history prefix.
9. Voice delivery preserves provenance and has tested interruption/response behavior.
10. Custom adapters explicitly support context or receive an actionable compatibility failure.

## Primary references

Provider details were researched from official documentation. No live model inference or billing experiment was performed; capability support must be verified against the selected endpoint and model at implementation time.

- [OpenAI Chat API](https://developers.openai.com/api/reference/resources/chat)
- [OpenAI Responses SDK types](https://github.com/openai/openai-node/blob/main/src/resources/responses/responses.ts)
- [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling)
- [Anthropic mid-conversation system messages](https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages)
- [Anthropic tool-call handling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls)
- [Bedrock Converse message schema](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Message.html)
- [Bedrock mid-conversation system-message support](https://docs.aws.amazon.com/bedrock/latest/userguide/claude-messages-mid-conversation-system.html)
- [Gemini generateContent](https://ai.google.dev/api/generate-content)
- [OpenRouter message formats](https://openrouter.ai/docs/agent-sdk/call-model/message-formats)
- [MiMo OpenAI-compatible API](https://mimo.mi.com/docs/en-US/api/chat/openai-api)
- [MiMo reasoning continuation](https://platform.xiaomimimo.com/docs/en-US/usage-guide/passing-back-reasoning_content)
- [OpenAI Realtime client events](https://developers.openai.com/api/reference/resources/realtime/client-events)
- [Gemini Live API](https://ai.google.dev/api/live)

## Current patch validation

Regression tests exercise multiple tool rounds and parallel calls with runtime context, inbox reminders, or both. They verify that current results remain full, a real next user request permits older-result summaries, history stays unchanged, and complete tool bundles precede reminders. SDK-boundary tests cover the three affected adapters with media before/after snapshots, multiple media arrays, text-only merging, and input immutability. OpenRouter video-extension preservation and tracing metadata have explicit coverage.
