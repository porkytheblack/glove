import { BlogPostHeader } from "@/components/blog-post-header";
import { getPost, postMetadata } from "@/lib/blog";

const post = getPost("conversations-that-keep-their-purpose")!;

export const metadata = postMetadata(post);

export default async function Post() {
  return (
    <div className="docs-content">
      <BlogPostHeader post={post} />

      <p className="blog-lede">
        A conversational agent should be able to follow a detour without losing the purpose of the conversation. Glove’s goals, forms, and shared facts give developers explicit state for both the objectives and the details collected along the way.
      </p>

      <p>
        Those two responsibilities can pull in different directions. A travel concierge might need dates, accommodation preferences, and arrival details. The traveler might supply them in a different order, pause to ask about the destination, or change their mind halfway through.
      </p>

      <p>
        Goals describe what remains to be accomplished. Forms hold validated answers. Facts retain evidence that may become useful later. The model uses that state to decide how to continue the conversation.
      </p>

      <p>
        Consider a traveler planning a weekend in Naivasha:
      </p>

      <blockquote>
        “We’re arriving Friday, there are three of us, and we’ll probably need a transfer. Before we get into that, is there somewhere quiet to stay?”
      </blockquote>

      <p>
        That message contains several useful details and a question. A well-designed agent can answer the question, record the details, and continue from what remains unresolved.
      </p>

      <h2 id="goals-keep-track-of-the-purpose">
        Goals keep track of the purpose
      </h2>

      <p>
        <a href="/docs/goals">Dynamic goals</a> live in <code>glove-memory/goals</code>. A goal program contains ordered objectives with stable, keyed checklist items. For this concierge, those objectives might be to understand the trip, establish accommodation preferences, and settle arrival arrangements.
      </p>

      <p>
        The agent can update later goals before earlier ones are complete. If the traveler volunteers arrival details immediately, the system can record that progress immediately.
      </p>

      <p>
        Goals also distinguish completion, deferral, and decline. “I’ll send my flight number later” leaves a visible follow-up. “We don’t want a transfer” records a different decision. Both can allow the conversation to move forward without pretending a transfer has been booked.
      </p>

      <p>
        A goal is marked complete when its items are settled, which can include deferral or decline. Deferred work remains visible. Applications that require an obligation to be fulfilled can enforce that requirement through their goal policy.
      </p>

      <p>
        The objectives themselves can evolve. If the traveler changes from a weekend break to a work trip, the program can be revised with an expected version and a reason. Stable keys preserve existing progress; new obligations get new keys. The history records how the conversation changed direction.
      </p>

      <h2 id="forms-give-the-details-structure">
        Forms give the details structure
      </h2>

      <p>
        <a href="/docs/forms">Conversational forms</a> live alongside goals in <code>glove-memory/forms</code>. Developers define fields using Zod schemas, group them into steps, and specify when each field applies.
      </p>

      <p>
        Steps guide what to ask next. They do not prevent the agent from accepting a valid answer to a later question.
      </p>

      <p>
        The concierge can therefore save the arrival day and party size from that first message while discussing accommodation. It does not need to ask those questions again simply because they appeared early.
      </p>

      <p>
        Conditional fields also survive changes of mind. Suppose the traveler supplies a flight number, then decides to drive. A form can make the flight number applicable only when an airport transfer is needed. The existing answer becomes <em>held</em>: retained in history, but excluded from current values and completion requirements. If the traveler switches back, it can become applicable again.
      </p>

      <p>
        Corrections append to answer history. Retraction, undo, and redo let the conversation revisit earlier answers without losing what happened.
      </p>

      <p>
        Goals and forms remain separate. Filling a form does not automatically complete a goal. The application decides which validated answers satisfy which objectives and records that relationship through the goal runner.
      </p>

      <h2 id="facts-preserve-information-before-a-workflow-needs-it">
        Facts preserve information before a workflow needs it
      </h2>

      <p>
        Sometimes useful information arrives before the relevant form has started. <a href="https://github.com/porkytheblack/glove/blob/main/packages/glove-facts/README.md">glove-facts</a> gives the application a shared, scoped evidence store for that information.
      </p>

      <p>
        One recorded fact can support several requirements. A confirmed arrival date might help prepare an arrival form and satisfy an item in the trip-planning goals. Each workflow retains its own link to the evidence.
      </p>

      <p>
        Automatic preparation is optional. The application supplies a dedicated Glove agent with its own store and tracing subscribers. Preparation runs through that agent’s normal request path, so its model calls, tool execution, and usage remain observable.
      </p>

      <p>
        The application also specifies which requirements preparation may resolve. Form schemas and evidence rules still control what gets committed. A traveler saying “I intend to book the transfer” cannot serve as verified evidence that the booking succeeded.
      </p>

      <p>
        When evidence changes, preparation can flag existing work for review. It does not silently overwrite an answer or repeat a completed action. The host or conversational agent resolves the correction through ordinary workflow operations.
      </p>

      <h2 id="the-same-workflow-tools-can-participate-in-spoken-conversations">
        The same workflow tools can participate in spoken conversations
      </h2>

      <p>
        <a href="/docs/realtime-voice">RealtimeAgent</a> in <code>glove-voice-s2s</code> exposes a built Glove agent’s tools to speech-to-speech adapters, including OpenAI Realtime and Gemini Live.
      </p>

      <p>
        The realtime model handles the conversation, while tool calls execute the same goal and form operations with schema validation. Goals and forms register context providers that render their current state. The voice bridge reads that context at startup and refreshes it after successful tool execution. Changed snapshots are injected with <code>respond: false</code>, so an update does not request a spoken response of its own.
      </p>

      <p>
        If another part of the application changes the trip, the host calls <code>await realtime.refreshContext()</code>. The bridge does not poll storage before every audio turn.
      </p>

      <p>
        Speech interruption and workflow revision are different concerns. The voice provider handles audio turn-taking; the application records changes of mind through goals, forms, and facts. An interrupted spoken response does not itself undo a committed workflow operation.
      </p>

      <p>
        The voice host owns transcript logging and persistence, and must restrict tools appropriately: the realtime bridge does not run the text executor’s permission prompts. The <a href="https://github.com/porkytheblack/glove/blob/main/packages/glove-voice-s2s/README.md">voice integration guide</a> describes those boundaries.
      </p>

      <p>
        For applications built with Glove Foundry, goals, facts, forms, and context providers are <a href="https://github.com/porkytheblack/glove/blob/main/packages/glove-foundry/docs/guidance.md">first-class lazy configuration fields</a>. Foundry mounts the native components and exposes their runners to application code. Durable SQLite adapters support single-host persistence; in-memory adapters remain useful for prototypes.
      </p>

      <p>
        Start with the objectives the conversation needs to settle, define schemas for the details it collects, and connect validated answers to goal progress. Add shared facts when information needs to travel between workflows. The traveler can then interrupt, answer early, defer a detail, or change direction while the application retains what is known and what still needs attention.
      </p>
    </div>
  );
}
