// Step-through pictures of how Foundry moves work around. Colours follow the
// docs: mint for agents (Glove), blue for what Foundry runs around them.

import { FlowStory } from "./flow-story";

// ─── Mesh: an interactor hands work to a worker and hears back ───────────────

export function MeshStory() {
  return (
    <FlowStory
      id="fsd"
      viewBox="0 0 932 250"
      label="An interactor agent messages a worker agent over the mesh Foundry hosts, answers the worker's question from memory, and relays the worker's reply to the person"
      boxes={[
        { id: "person", x: 16, y: 60, w: 120, h: 60, title: "Person", sub: "chat or call" },
        { id: "interactor", x: 206, y: 40, w: 190, h: 100, title: "Iris (maya)", sub: "layer 1 · fast · knows them", tone: "harness" },
        { id: "memory", x: 231, y: 184, w: 140, h: 52, title: "Personal memory", sub: "glove-memory", tone: "harness", dashed: true },
        { id: "foundry", x: 506, y: 60, w: 160, h: 60, title: "Foundry mesh", sub: "one thread per job", tone: "system" },
        { id: "worker", x: 776, y: 40, w: 140, h: 100, title: "Coder", sub: "maya-coder · sandbox", tone: "harness" },
      ]}
      edges={[
        { id: "ask", d: "M136,77 L202,77", label: "asks", lx: 169, ly: 69 },
        { id: "tell", d: "M202,105 L140,105", label: "tells", lx: 171, ly: 121 },
        { id: "send", d: "M396,77 L502,77", label: "send", lx: 449, ly: 69 },
        { id: "start", d: "M666,77 L772,77", label: "message", lx: 719, ly: 69 },
        { id: "question", d: "M772,105 L670,105", label: "ask · reply", lx: 721, ly: 121 },
        { id: "back", d: "M502,105 L400,105", label: "delivered", lx: 451, ly: 121 },
        { id: "recall", d: "M301,180 L301,144", label: "recalls", lx: 309, ly: 166, anchor: "start" },
      ]}
      steps={[
        {
          lit: ["person", "interactor", "ask"],
          packet: { edge: "ask", label: "request" },
          title: "The person asks",
          text: (
            <>
              The interactor is the one agent the person talks to. It runs on a fast model and
              keeps their context: who they are, what they like, what they are waiting on.
            </>
          ),
        },
        {
          lit: ["interactor", "foundry", "worker", "send", "start"],
          packet: { edge: "send", label: "write slugify" },
          title: "It messages a teammate",
          text: (
            <>
              <code>glove_mesh_list_agents</code> shows the other agents in Maya&apos;s workspace.
              <code> glove_mesh_send_message</code> to <code>maya-coder</code> returns at once. Foundry
              opens a thread, a conversation on the coder, and starts a run there.
            </>
          ),
        },
        {
          lit: ["person", "interactor", "tell"],
          packet: { edge: "tell", label: "on it" },
          title: "…and keeps talking",
          text: <>The interactor&apos;s turn ends in a second. Nobody waits on the slow work.</>,
        },
        {
          lit: ["worker", "foundry", "interactor", "question", "back"],
          packet: { edge: "question", label: "which language?" },
          title: "The worker needs something",
          text: (
            <>
              The coder cannot tell which language Maya wants, so it messages whoever sent the
              work, with <code>blocking: true</code>. Its run waits up to <code>waitMs</code>,
              keeping its sandbox.
            </>
          ),
        },
        {
          lit: ["memory", "interactor", "recall", "send", "foundry", "start", "worker"],
          packet: { edge: "send", label: "TypeScript" },
          title: "The interactor answers from what it knows",
          text: (
            <>
              The question arrives as a <code>&lt;mesh-message&gt;</code>. Memory already has the
              answer, so the interactor replies with <code>in_reply_to</code> without bothering
              Maya. If it did not know, it would ask her first. The answer lands in the waiting run
              as the tool&apos;s result.
            </>
          ),
        },
        {
          lit: ["worker", "foundry", "interactor", "question", "back"],
          packet: { edge: "back", label: "reply" },
          title: "The reply comes back",
          text: (
            <>
              The coder&apos;s final answer is sent back on its own. Foundry delivers it to the
              conversation that asked: straight into a run that is listening, such as a call, or as
              a new turn once the conversation is free.
            </>
          ),
        },
        {
          lit: ["interactor", "person", "tell"],
          packet: { edge: "tell", label: "it is ready" },
          title: "The person hears it",
          text: (
            <>
              The interactor passes on what matters. Open threads sit in its runtime context the
              whole time, so &ldquo;how is that going?&rdquo; needs no tool call.
            </>
          ),
        },
      ]}
    />
  );
}

// ─── A voice call that hands work off ────────────────────────────────────────

export function VoiceCallStory() {
  return (
    <FlowStory
      id="fsv"
      viewBox="0 0 932 150"
      label="A voice call: the caller's audio reaches a speech session over the agent through a room; slow work goes to another agent over the mesh, and its reply is spoken at the next pause"
      boxes={[
        { id: "caller", x: 16, y: 40, w: 110, h: 64, title: "Caller", sub: "browser · phone" },
        { id: "room", x: 186, y: 40, w: 130, h: 64, title: "Room", sub: "WebSocket · LiveKit" },
        { id: "session", x: 376, y: 22, w: 180, h: 100, title: "voiceCall", sub: "speech session over the agent", tone: "harness" },
        { id: "foundry", x: 636, y: 40, w: 120, h: 64, title: "Foundry", sub: "hosts the mesh", tone: "system" },
        { id: "worker", x: 806, y: 40, w: 110, h: 64, title: "Worker", sub: "a teammate", tone: "harness" },
      ]}
      edges={[
        { id: "in", d: "M126,60 L182,60", label: "audio", lx: 154, ly: 52 },
        { id: "out", d: "M182,86 L130,86", label: "speech", lx: 156, ly: 102 },
        { id: "up", d: "M316,60 L372,60" },
        { id: "down", d: "M372,86 L320,86" },
        { id: "send", d: "M556,60 L632,60", label: "send", lx: 594, ly: 52 },
        { id: "task", d: "M756,60 L802,60" },
        { id: "result", d: "M802,86 L760,86" },
        { id: "update", d: "M632,86 L560,86", label: "reply", lx: 596, ly: 102 },
      ]}
      steps={[
        {
          lit: ["caller", "room", "session", "in", "up"],
          packet: { edge: "up", label: "audio" },
          title: "The caller speaks",
          text: (
            <>
              The room moves audio. <code>voiceCall</code> runs a realtime speech session over the
              assembled agent: the same prompt, tools, memory and context as its text turns. What
              both sides say is saved to the conversation.
            </>
          ),
        },
        {
          lit: ["session", "foundry", "worker", "send", "task"],
          packet: { edge: "send", label: "book a table" },
          title: "Slow work goes to a teammate",
          text: (
            <>
              The call stays thin. It sends the work to another agent with{" "}
              <code>glove_mesh_send_message</code>. Tools that need an approval, and Foundry&apos;s
              bookkeeping tools, are kept off the call.
            </>
          ),
        },
        {
          lit: ["caller", "room", "session", "down", "out"],
          packet: { edge: "out", label: "anything else?" },
          title: "The conversation goes on",
          text: <>The caller keeps talking with the agent while the work runs in another process.</>,
        },
        {
          lit: ["worker", "foundry", "session", "result", "update"],
          packet: { edge: "update", label: "reply" },
          title: "The reply arrives mid-call",
          text: (
            <>
              The call listens on its conversation, so Foundry hands the reply straight to it
              instead of starting a new run.
            </>
          ),
        },
        {
          lit: ["session", "room", "caller", "down", "out"],
          packet: { edge: "out", label: "booked for eight" },
          title: "Spoken at the next pause",
          text: (
            <>
              <code>voiceCall</code> waits until nobody is speaking (at most eight seconds), then tells
              the model, which tells the caller. If they have hung up, the message is saved for the
              next turn instead.
            </>
          ),
        },
      ]}
    />
  );
}

// ─── A ticket's journey through an app ───────────────────────────────────────

export function MessageJourneyStory() {
  return (
    <FlowStory
      id="fsm"
      viewBox="0 0 920 380"
      label="An inbound ticket passes through a transmission and a playbook to an instance's conversation, starts a run, and the reply goes back out through the app's outbound tool"
      boxes={[
        { id: "provider", x: 16, y: 40, w: 150, h: 60, title: "Help desk", sub: "the provider" },
        { id: "transmission", x: 246, y: 40, w: 170, h: 60, title: "Transmission", sub: "verify · normalise", tone: "system" },
        { id: "playbook", x: 496, y: 40, w: 170, h: 60, title: "Playbook", sub: "match · predicate", tone: "system" },
        { id: "conversation", x: 496, y: 170, w: 170, h: 60, title: "Conversation", sub: "one per ticket thread", tone: "system" },
        { id: "run", x: 246, y: 170, w: 170, h: 60, title: "Run", sub: "a fresh Glove", tone: "harness" },
        { id: "outbound", x: 16, y: 170, w: 150, h: 60, title: "Outbound tool", sub: "glove_app_…_send", tone: "system" },
        { id: "approval", x: 246, y: 300, w: 170, h: 56, title: "Approval", sub: "when the send needs one", tone: "system", dashed: true },
        { id: "inspector", x: 746, y: 170, w: 160, h: 60, title: "Inspector", sub: "every hop, recorded" },
      ]}
      edges={[
        { id: "webhook", d: "M166,70 L242,70", label: "webhook", lx: 204, ly: 62 },
        { id: "typed", d: "M416,70 L492,70", label: "typed event", lx: 454, ly: 62 },
        { id: "routes", d: "M581,100 L581,166", label: "thread key", lx: 591, ly: 138, anchor: "start" },
        { id: "starts", d: "M496,200 L420,200", label: "message", lx: 458, ly: 192 },
        { id: "reply", d: "M246,200 L170,200", label: "reply", lx: 208, ly: 192 },
        { id: "gate", d: "M331,230 L331,296", label: "waits", lx: 339, ly: 268, anchor: "start", dashed: true },
        { id: "deliver", d: "M91,170 L91,104", label: "delivered", lx: 99, ly: 142, anchor: "start" },
        { id: "trace", d: "M666,200 L742,200", label: "events", lx: 704, ly: 192 },
      ]}
      steps={[
        {
          lit: ["provider", "transmission", "webhook"],
          packet: { edge: "webhook", label: "ticket 4411" },
          title: "An event arrives",
          text: (
            <>
              The help desk calls your webhook, or a connection you defined polls it. The
              transmission checks the signature and turns the provider&apos;s body into a typed
              event. A second delivery of the same event id stops here.
            </>
          ),
        },
        {
          lit: ["transmission", "playbook", "typed"],
          packet: { edge: "typed", label: "ticket-created" },
          title: "Playbooks decide who handles it",
          text: (
            <>
              Every instance&apos;s playbooks are checked: the event, the route it came in on, and
              predicates such as &ldquo;priority at least high&rdquo;. No match means no run and no
              model call.
            </>
          ),
        },
        {
          lit: ["playbook", "conversation", "routes"],
          packet: { edge: "routes", label: "thread 4411" },
          title: "It lands in the right conversation",
          text: (
            <>
              The thread key maps the ticket to one conversation, so every later message on it
              arrives with the history. A playbook subscription can create the instance on the first
              event.
            </>
          ),
        },
        {
          lit: ["conversation", "run", "starts"],
          packet: { edge: "starts", label: "message" },
          title: "A run assembles",
          text: (
            <>
              The run builds a fresh Glove from the definition, the instance (with the apps it
              installed) and the message, with the playbook&apos;s instruction attached.
            </>
          ),
        },
        {
          lit: ["run", "outbound", "approval", "reply", "gate"],
          packet: { edge: "reply", label: "reply" },
          title: "The reply goes out through a tool",
          text: (
            <>
              Installing the app gave the agent <code>glove_app_helpdesk__tickets_send</code>. Its
              input is checked against the transmission&apos;s schema, and if the transmission says
              so, it waits for a person to approve it first.
            </>
          ),
        },
        {
          lit: ["outbound", "provider", "deliver"],
          packet: { edge: "deliver", label: "comment" },
          title: "Delivered with your credentials",
          text: (
            <>
              The delivery adapter runs in the Foundry server, with credentials from an adapter you
              wrote. The agent&apos;s process never sees them.
            </>
          ),
        },
        {
          lit: ["conversation", "inspector", "trace", "run"],
          packet: { edge: "trace", label: "trace" },
          title: "Every hop is on the record",
          text: (
            <>
              The inspector shows the inbound event, the matched playbook, the run, the tool call and
              the delivery in one trace.
            </>
          ),
        },
      ]}
    />
  );
}
