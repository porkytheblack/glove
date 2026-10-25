import { DocCards } from "@/components/doc-cards";
import { docsMetadata, docsSections } from "@/lib/docs-nav";

export const metadata = docsMetadata("/docs/showcase");

const repo = "https://github.com/porkytheblack/glove/tree/main/examples";

const foundryExamples = [
  {
    href: "/foundry/docs/rebuilds/grok-bot",
    kicker: "Rebuild · Grok Bot · Foundry · Kuiper",
    title: "Bot Crew",
    desc: "One bot definition; every bot a person makes is data, with its own name, job, apps and memory. A new bot names itself when told its job. Bots work in the apps the person connects (Gmail and Linear as Foundry apps with their accounts), read them in code, and wait for approval before sending; new mail reaches the main bot. Bots message each other over the mesh, share group chats and one computer, and learn skills that run as routines.",
  },
  {
    href: "/foundry/docs/rebuilds/claude-duet",
    kicker: "Rebuild · Claude Duet · Foundry · Kuiper",
    title: "Proactive Partner",
    desc: "One partner in one thread, working in the person's Gmail and Calendar: a morning brief and quiet check-ins in the person's time zone, new mail as it lands, approvals before it sends, pays, signs or deletes, a guard that never lets a card number out, voice, and its own computer.",
  },
  {
    href: "/foundry/docs/rebuilds/openai-dots",
    kicker: "Rebuild · OpenAI Dots · Foundry · Kuiper",
    title: "Standing Agents",
    desc: "A dot you name, holding your ongoing responsibilities: a connected mailbox, read-only research on a schedule, an auto-review with Custom Rules (allow, ask, block) in front of every action, its own computer, the same dot in the app, Slack and on a call, and specialist dots as instances with their own account.",
  },
  {
    href: `${repo}/foundry-layered-assistant`,
    kicker: "Foundry · mesh · voice",
    title: "Layered Assistant",
    desc: "A fast interactor with personal memory takes chat or calls and messages a coder and a researcher over the mesh. Workers ask back when they need something; replies return to the chat or are spoken mid-call.",
  },
  {
    href: "/foundry/docs/browser-and-sandbox",
    kicker: "Foundry · glove-execution",
    title: "Operator",
    desc: "A browser and coding agent: visits sites, signs in where you tell it to, writes an app and keeps its server running in a persistent container. Local console plus the Foundry inspector.",
  },
  {
    href: `${repo}/foundry-braind-storm`,
    kicker: "Foundry · mesh · glove-image · voice",
    title: "Braind Storm",
    desc: "A brand workforce: you speak with the lead, who convenes four specialist agents over Glove Mesh. They share one sandboxed workspace, pass /out/… paths, write Word documents, generate and critique key art, and stream progress to a live observatory.",
  },
  {
    href: `${repo}/foundry-agent`,
    kicker: "Foundry · reference app",
    title: "Foundry reference application",
    desc: "The canonical small Foundry project: a release planner, a typed custom handler, and a guided-intake agent using goals, facts and forms on durable SQLite adapters.",
  },
  {
    href: `${repo}/foundry-drag-racers`,
    kicker: "Foundry · Gemini Live",
    title: "Drag Racer Calls",
    desc: "A speech-to-speech web app: pick a fictional racer and join a live call. Each racer is a pure Foundry definition assembled lazily per message.",
  },
];

const moreExamples = [
  {
    href: `${repo}/document-desk`,
    kicker: "Working environment",
    title: "Document Desk",
    desc: "Drop in a PDF, workbook, deck or image and ask for something. The agent writes code against your files instead of choosing from a menu of actions.",
  },
  {
    href: `${repo}/analyst-desk`,
    kicker: "Working environment · eval",
    title: "Analyst Desk",
    desc: "An 80-page annual report and a messy sales export in, a briefing, deck and PDF out — with graders and a hard budget ceiling.",
  },
  {
    href: `${repo}/classifier-inbox`,
    kicker: "glove-classifier · benchmark",
    title: "Classifier Inbox",
    desc: "Triage a labelled 80-message support inbox with classifier models, as a REPL program, an agent tool and a benchmark.",
  },
  {
    href: `${repo}/layered-voice`,
    kicker: "Voice · mesh",
    title: "Layered Voice Agents",
    desc: "A fast front agent keeps the conversation while a worker agent does the heavy lifting behind it over the mesh.",
  },
  {
    href: `${repo}/image-studio`,
    kicker: "glove-image",
    title: "Image Studio",
    desc: "An art-director agent that saves characters, generates, edits, regenerates and assembles — the smallest complete tour of agentic image generation.",
  },
  {
    href: `${repo}/video-studio`,
    kicker: "glove-image · glove-video",
    title: "Video Studio",
    desc: "Concept → keyframe → animation → independent video review → revision, revealing only the strongest passing take.",
  },
];

export default function ShowcasePage() {
  const walkthroughs =
    docsSections
      .find((section) => section.title === "Showcase")
      ?.items.filter((item) => item.href !== "/docs/showcase") ?? [];

  return (
    <article className="docs-content">
      <h1>Showcase</h1>
      <p className="blog-lede">
        Complete applications built with Glove. The walkthroughs explain every file;
        the examples are runnable from the{" "}
        <a href="https://github.com/porkytheblack/glove/tree/main/examples">repository</a>.
      </p>

      <h2 id="foundry-systems">Foundry agent systems</h2>
      <p>
        Multi-agent, persistent, observable applications built on{" "}
        <a href="/foundry">Glove Foundry</a>.
      </p>
      <DocCards cards={foundryExamples} />

      <h2 id="walkthroughs">Step-by-step walkthroughs</h2>
      <p>
        Each tutorial builds an application from an empty folder, focusing on the
        display stack, voice, and server-side agents.
      </p>
      <DocCards
        cards={walkthroughs.map((item) => ({
          href: item.href,
          title: item.label,
          badge: item.badge,
          desc: item.summary ?? "",
          packages: item.packages,
        }))}
      />

      <h2 id="more-examples">More runnable examples</h2>
      <DocCards cards={moreExamples} />

      <h2 id="galleries">Galleries</h2>
      <DocCards
        cards={[
          {
            href: "/docs/image/gallery",
            kicker: "glove-image",
            title: "Image gallery",
            desc: "A campaign shot in one scripted run — every frame with its real prompt, pipeline trace and cost.",
          },
          {
            href: "/docs/video/gallery",
            kicker: "glove-video",
            title: "Video gallery",
            desc: "One brief to one approved cut, including the rejected takes, review verdicts and real spend.",
          },
        ]}
      />
    </article>
  );
}
