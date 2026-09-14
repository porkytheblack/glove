import { CodeBlock } from "@/components/code-block";
import { BlogPostHeader } from "@/components/blog-post-header";
import { getPost, postMetadata } from "@/lib/blog";

const post = getPost("fresh-context-in-the-agent-loop")!;

export const metadata = postMetadata(post);

export default async function Post() {
  return (
    <div className="docs-content">
      <BlogPostHeader post={post} />

      <p className="blog-lede">
        Context providers give Glove agents a fresh view of application state before every model iteration, without rewriting their system instructions or saving snapshots as conversation history.
      </p>

      <p>
        A trip’s destination can change. A background lookup can finish. A form can acquire an answer. A goal can become complete between two model calls in the same request.
      </p>

      <p>
        The distinction is useful: instructions describe how the agent should behave; working context describes what is true right now. <a href="https://github.com/porkytheblack/glove/blob/main/packages/glove/README.md#live-runtime-context">Runtime context in glove-core</a> gives that changing state a place in the loop.
      </p>

      <p>
        The core API is small. <code>addContextProvider</code> registers a callback that returns text, synchronously or asynchronously. It can return <code>null</code> or <code>undefined</code> when it has nothing to contribute, and registration returns a function that removes the provider.
      </p>

      <p>
        For example, a travel concierge can read its current trip before each model call. Here, <code>agent</code> is an existing Glove instance and <code>loadCurrentTrip</code> is an application-owned loader that returns only the trip details the model should see:
      </p>

      <CodeBlock
        language="typescript"
        code={`const removeContext = agent.addContextProvider(async (signal) => {
  const trip = await loadCurrentTrip(signal);
  return trip ? \`Current trip state:\\n\${JSON.stringify(trip)}\` : null;
});`}
      />

      <p>
        Glove calls the provider when preparing model input. If a tool updates the trip, the next model iteration reads its current state.
      </p>

      <p>
        Several providers can be registered independently. One might expose the trip, another the status of an asynchronous lookup, and another the current selection in an application. <a href="https://github.com/porkytheblack/glove/blob/main/packages/glove-memory/README.md#runtime-context-context-forms-and-goals">Forms, goals, and pinned context</a> use this same mechanism; the core API has no dependency on their schemas. Applications can also use it for job status, workspace state, or a changing set of available resources.
      </p>

      <p>
        The provider’s output is a synthetic context message supplied by the framework. In the current implementation, Glove appends it as user-role content with <code>framework_context: "runtime"</code> metadata. It follows stored conversation history and complete tool-result bundles.
      </p>

      <p>
        That placement gives the model a fresh view of external state without saving another copy of that state as a conversation message. On the next iteration, Glove reconstructs the model input and resolves the providers again.
      </p>

      <p>
        The source of truth stays in the application’s adapter or store.
      </p>

      <h2 id="this-also-fixes-a-specific-prompt-caching-problem">
        This also fixes a specific prompt-caching problem
      </h2>

      <p>
        Previously, the memory integrations rendered changing state into sections of the system prompt. The implementation used <code>attachPromptSection</code> to maintain those sections and called <code>setSystemPrompt</code> as they changed.
      </p>

      <p>
        A completed checklist item or a newly filled form field therefore changed text near the beginning of the model request. For prefix-based caching, the reusable prefix stops at the changed content. Even when the conversation history remained identical, the changing system section could prevent reuse of the prefix extending through that history.
      </p>

      <p>
        The <a href="https://github.com/porkytheblack/glove/commit/456924850ae05179f8a3daf6ba7bc75ebd0d4381">fix</a> removed those mutable system-prompt sections and moved their content to transient messages at the end of model input.
      </p>

      <p>
        Conceptually, the request changed from:
      </p>

      <CodeBlock
        language="text"
        code={`Instructions + changing memory state
Conversation history`}
      />

      <p>
        to:
      </p>

      <CodeBlock
        language="text"
        code={`Instructions
Conversation history
Current memory snapshot`}
      />

      <p>
        Caching was not disabled. The change preserves the stable system and history prefix while allowing the trailing state to change.
      </p>

      <p>
        Actual cache hits still depend on provider formatting, configuration, minimum sizes, and breakpoint placement. The fix preserves the opportunity for prefix reuse; applications should check provider-reported cache usage to measure the result.
      </p>

      <p>
        The new timing also improves freshness. The old form integration refreshed its prompt section before a request. A field filled during tool execution could therefore leave that section outdated until the next request. Context providers run before each model iteration, including the iteration after a tool result.
      </p>

      <h2 id="synthetic-context-still-needs-careful-message-handling">
        Synthetic context still needs careful message handling
      </h2>

      <p>
        A framework snapshot uses a supported provider role, but it is not a new human utterance.
      </p>

      <p>
        The <a href="https://github.com/porkytheblack/glove/commit/3255c0ca">follow-up correction</a> adds provenance and excludes framework context from the calculation of the last real user turn. Otherwise, with tool-result summarization enabled, a fresh snapshot could cause full results from the current turn to be replaced by their summaries prematurely.
      </p>

      <p>
        The same correction preserves structured images and video when certain adapters merge adjacent user messages. Appending a text snapshot must not flatten an existing media message into a string.
      </p>

      <p>
        The framework marker identifies where the message came from. It does not grant stored user content the authority of system instructions.
      </p>

      <p>
        Providers should remain focused on reading and rendering state. They receive an abort signal, and the core loop stops before calling the model if a provider fails. Expensive preparation or inference belongs in an explicit workflow operation, not inside a repeatedly evaluated snapshot callback.
      </p>

      <p>
        Subscribers can observe resolved snapshots through the <code>runtime_context</code> event. External runtimes can obtain them through <code>getRuntimeContext()</code>. The <a href="https://github.com/porkytheblack/glove/blob/main/packages/glove-voice-s2s/README.md#live-memory-context">realtime voice bridge</a> uses that method at startup and after tools; hosts call <code>await realtime.refreshContext()</code> after external changes. Earlier voice snapshots may remain in the provider’s session history, with later snapshots identifying themselves as replacements.
      </p>

      <p>
        Context providers arrived with the <a href="https://github.com/porkytheblack/glove/blob/main/packages/glove/CHANGELOG.md">glove-core 4 compatibility change</a>. Custom runnable wrappers must forward <code>addContextProvider</code> and <code>getRuntimeContext</code>; custom builders need provider registration support. Goals and forms can opt out of their default status injection when an application supplies its own renderer.
      </p>

      <p>
        Keep authoritative state in a store, expose a concise view through a provider, and keep behavioral instructions in the system prompt. After a tool changes the trip, completes a job, or updates a resource, the next model call can work from the new state.
      </p>
    </div>
  );
}
