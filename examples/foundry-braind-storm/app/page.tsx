"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TEAM, type StormActivity, type StormArtifact, type StormFoundryEvent, type StormResult, type StormTelemetry } from "../lib/protocol";
import { useBriefingCall } from "./lib/use-briefing-call";

type ChatMessage = { role: "user" | "assistant"; text: string };
type Phase = "idle" | "starting" | "running" | "done" | "error";
type StreamState = "idle" | "connecting" | "live" | "reconnecting";
type CampaignItemSummary = {
  campaignId: string;
  name: string;
  stormId: string;
  status: "queued" | "running" | "completed" | "failed" | "skipped";
  runId?: string;
  error?: string;
};
type CampaignBatchSummary = {
  batchId: string;
  runId: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  requestedExecution: "auto" | "parallel" | "sequential";
  resolvedExecution: "parallel" | "sequential" | "dependency-waves";
  waves: ReadonlyArray<ReadonlyArray<string>>;
  items: ReadonlyArray<CampaignItemSummary>;
  createdAt: string;
};

function telemetryFrom(event: StormFoundryEvent): StormTelemetry | null {
  if (!event.type.endsWith("braind.telemetry") || !event.data || typeof event.data !== "object") return null;
  const candidate = event.data as Partial<StormTelemetry>;
  return typeof candidate.title === "string" && typeof candidate.detail === "string" && typeof candidate.status === "string"
    ? candidate as StormTelemetry
    : null;
}

function eventLabel(event: StormFoundryEvent): string {
  const telemetry = telemetryFrom(event);
  if (telemetry) return telemetry.title;
  if (event.type.endsWith("braind.mesh.handoff")) return "Mesh handoff delivered";
  return event.type.replace(/^agent\./, "").replaceAll(".", " / ").replaceAll("_", " ");
}

function clock(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const PACKS = [
  { id: "marketing", label: "Marketing", note: "voice, campaigns, content" },
  { id: "product-management", label: "Product", note: "research, specs, landscape" },
  { id: "sales", label: "Sales", note: "accounts, narratives, enablement" },
  { id: "small-business", label: "Small business", note: "practical launch motions" },
];

const STARTERS = [
  "Create a category-defining brand for a private, local-first AI workspace for architects.",
  "Find a sharper position and launch idea for a premium non-alcoholic night drink.",
  "Build the brand world and go-to-market for an African climate intelligence platform.",
];

const JOURNEY = [
  { id: "brief", label: "Frame the brief", agent: "lead", agentName: "Mara", steps: ["convene", "workspace"], description: "Clarifies the problem and opens the shared workspace." },
  { id: "research", label: "Find the signal", agent: "scout", agentName: "Iris", steps: ["lead-to-scout", "sense"], description: "Finds audience, market, and cultural tensions worth using." },
  { id: "strategy", label: "Choose a position", agent: "strategist", agentName: "Theo", steps: ["scout-to-strategist", "shape"], description: "Turns the evidence into a position and launch path." },
  { id: "creative", label: "Build the idea", agent: "maker", agentName: "Noor", steps: ["strategist-to-maker", "make", "render"], description: "Creates the brand territory, language, and key-art direction." },
  { id: "review", label: "Pressure-test it", agent: "critic", agentName: "Vera", steps: ["maker-to-critic", "pressure-test"], description: "Challenges weak assumptions and reviews the visible work." },
  { id: "decision", label: "Make the call", agent: "lead", agentName: "Mara", steps: ["critic-to-lead", "decide", "package", "complete"], description: "Returns one recommendation, the dissent, and the next decision." },
] as const;

export default function Home() {
  const [brief, setBrief] = useState(STARTERS[0]);
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: "assistant", text: "I’m Mara. Give me the business, the audience, and what feels unresolved. I’ll pull the right minds into the storm and come back with a point of view—not a committee average." }]);
  const [packs, setPacks] = useState<string[]>(["marketing"]);
  const [generateImage, setGenerateImage] = useState(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [activity, setActivity] = useState<StormActivity[]>([]);
  const [artifacts, setArtifacts] = useState<StormArtifact[]>([]);
  const [error, setError] = useState("");
  const [activeAgent, setActiveAgent] = useState("lead");
  const [callText, setCallText] = useState("");
  const [activeRunId, setActiveRunId] = useState("");
  const [foundryEvents, setFoundryEvents] = useState<StormFoundryEvent[]>([]);
  const [streamState, setStreamState] = useState<StreamState>("idle");
  const [selectedSequence, setSelectedSequence] = useState<number | null>(null);
  const [campaignBatches, setCampaignBatches] = useState<CampaignBatchSummary[]>([]);
  const stormId = useRef(`storm-${Date.now()}`);
  const briefingCall = useBriefingCall();

  useEffect(() => {
    if (!activeRunId) return;
    setStreamState("connecting");
    const source = new EventSource(`/api/activity?runId=${encodeURIComponent(activeRunId)}`);
    source.onopen = () => setStreamState("live");
    source.onerror = () => setStreamState("reconnecting");
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as StormFoundryEvent;
        setFoundryEvents((current) => {
          if (current.some((item) => item.sequence === event.sequence)) return current;
          return [...current, event].slice(-400);
        });
        const telemetry = telemetryFrom(event);
        if (telemetry?.agent && telemetry.status === "active") setActiveAgent(telemetry.agent);
      } catch {
        // A malformed extension event should not break the live observatory.
      }
    };
    return () => source.close();
  }, [activeRunId]);

  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/campaigns?parentStormId=${encodeURIComponent(stormId.current)}`, { cache: "no-store" });
        const body = await response.json() as { batches?: CampaignBatchSummary[] };
        if (!disposed && response.ok) setCampaignBatches(body.batches ?? []);
      } catch {
        // A call remains usable when this optional queue projection is temporarily unavailable.
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1_500);
    return () => { disposed = true; window.clearInterval(timer); };
  }, []);

  const telemetry = useMemo(() => foundryEvents.map(telemetryFrom).filter((item): item is StormTelemetry => item !== null), [foundryEvents]);
  const progress = telemetry.reduce((value, item) => Math.max(value, item.progress ?? 0), phase === "done" ? 100 : 0);
  const selectedEvent = foundryEvents.find((event) => event.sequence === selectedSequence) ?? foundryEvents.at(-1);
  const selectedTelemetry = selectedEvent ? telemetryFrom(selectedEvent) : null;
  const exchangeCount = telemetry.filter((item) => item.kind === "mesh").length;
  const agentStates = useMemo(() => TEAM.map((member) => {
    const latest = telemetry.filter((item) => item.agent === member.id && item.kind !== "mesh").at(-1);
    const state = latest && ["active", "queued", "warning"].includes(latest.status) ? "active" : latest ? "complete" : "waiting";
    return { member, latest, state };
  }), [telemetry]);

  const latestTelemetry = telemetry.at(-1);
  const currentJourneyIndex = useMemo(() => {
    if (phase === "done") return JOURNEY.length - 1;
    if (!latestTelemetry) return 0;
    const index = JOURNEY.findIndex((step) => step.steps.includes(latestTelemetry.step as never));
    return index < 0 ? 0 : index;
  }, [latestTelemetry, phase]);

  const meaningfulUpdates = useMemo(() => telemetry
    .filter((item) => item.kind !== "mesh")
    .slice(-8)
    .reverse(), [telemetry]);

  const status = useMemo(() => ({
    idle: "The room is listening",
    starting: "Opening the storm",
    running: "The workforce is in motion",
    done: "A point of view has landed",
    error: "The storm lost pressure",
  })[phase], [phase]);

  const togglePack = (id: string) => setPacks((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  const watchCampaign = (runId: string) => {
    if (runId === activeRunId) return;
    setFoundryEvents([]);
    setSelectedSequence(null);
    setActiveRunId(runId);
  };

  async function submit() {
    const text = brief.trim();
    if (!text || phase === "running" || phase === "starting") return;
    setPhase("starting"); setError(""); setActivity([]); setArtifacts([]); setFoundryEvents([]); setSelectedSequence(null); setActiveRunId("");
    const next = [...messages, { role: "user" as const, text }];
    setMessages(next); setBrief("");
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: text, stormId: stormId.current, skillPacks: packs, generateImage, transcript: messages }) });
      const started = await response.json() as { runId?: string; error?: string };
      if (!response.ok || !started.runId) throw new Error(started.error ?? "Could not start the storm.");
      setActiveRunId(started.runId);
      setPhase("running");
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        const polled = await fetch(`/api/chat?runId=${encodeURIComponent(started.runId)}`, { cache: "no-store" });
        const state = await polled.json() as { run?: { status: string; error?: string; output?: { value?: StormResult } }; events?: Array<{ type: string; data: unknown }> ; error?: string };
        if (!polled.ok || !state.run) throw new Error(state.error ?? "Could not observe the storm.");
        const handoffs = (state.events ?? []).filter((event) => event.type.endsWith("braind.mesh.handoff")).map((event) => event.data as StormActivity);
        setActivity(handoffs);
        setActiveAgent(handoffs.at(-1)?.to ?? "lead");
        if (state.run.status === "failed" || state.run.status === "cancelled") throw new Error(state.run.error ?? `Run ${state.run.status}.`);
        if (state.run.status === "completed") {
          const result = state.run.output?.value;
          if (!result) throw new Error("The run completed without a result.");
          setMessages([...next, { role: "assistant", text: result.reply }]);
          setArtifacts(result.artifacts); setActivity(result.activity); setActiveAgent("lead"); setPhase("done");
          break;
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause)); setPhase("error");
    }
  }

  return (
    <main id="top">
      <header className="masthead">
        <a className="wordmark" href="#top" aria-label="Braind Storm home"><span>BRAIND</span><strong>STORM</strong></a>
        <nav aria-label="Page sections"><a href="#work">Live work</a><a href="#results">Results</a></nav>
        <div className="mastStatus"><i className={phase === "running" ? "live" : ""} /><span>{status}</span></div>
      </header>

      <section className="commandDeck" aria-labelledby="page-title">
        <div className="commandIntro">
          <p className="kicker">YOUR AGENTIC BRAND TEAM</p>
          <h1 id="page-title">Brief the lead.<br />Follow the <em>work.</em></h1>
          <p className="intro">Talk to Mara once. She coordinates research, strategy, creative, and review—then returns one clear recommendation with the work attached.</p>
          <div className="plainPromise"><span>5 specialists</span><span>1 shared workspace</span><span>1 accountable lead</span></div>
        </div>

        <form className="briefBuilder" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <label htmlFor="campaign-brief">What should the team solve?</label>
          <textarea id="campaign-brief" value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="Describe the business, audience, problem, and what a good outcome looks like…" rows={6} />
          <div className="starterRow" aria-label="Example briefs">
            {STARTERS.map((starter, index) => <button type="button" key={starter} onClick={() => setBrief(starter)}>Example {index + 1}</button>)}
          </div>
          <details className="workforceOptions">
            <summary>Customize expertise and outputs <span>{packs.length} selected · {generateImage ? "image on" : "documents only"}</span></summary>
            <div className="optionGrid">
              <fieldset>
                <legend>Expertise to load when needed</legend>
                <div className="packList">{PACKS.map((pack) => <button type="button" key={pack.id} className={packs.includes(pack.id) ? "selected" : ""} onClick={() => togglePack(pack.id)}><i /><span><b>{pack.label}</b><small>{pack.note}</small></span></button>)}</div>
              </fieldset>
              <div className="outputOptions">
                <label className="imageToggle"><span><b>Generate campaign imagery</b><small>Noor creates it; Vera reviews what is actually visible.</small></span><input type="checkbox" checked={generateImage} onChange={(event) => setGenerateImage(event.target.checked)} /><i /></label>
                <p>Credentials and provider accounts stay in host-defined adapters.</p>
              </div>
            </div>
          </details>
          <div className="briefActions">
            {briefingCall.state.phase === "idle"
              ? <button type="button" className="secondaryAction" onClick={() => void briefingCall.connect(stormId.current)}><i /> Call Mara instead</button>
              : <button type="button" className="secondaryAction live" onClick={() => void briefingCall.hangUp()}><i /> Hang up</button>}
            <button className="primaryAction" disabled={!brief.trim() || phase === "running" || phase === "starting"}>{phase === "running" || phase === "starting" ? "Team is working…" : "Start campaign"}<span>→</span></button>
          </div>
          {error && <div className="errorBox"><b>Campaign stopped</b>{error}</div>}
        </form>
      </section>

      {(briefingCall.state.phase !== "idle" || briefingCall.state.transcript.length > 0 || briefingCall.state.error) && <section className={`briefingLine ${briefingCall.state.phase === "live" ? "live" : ""}`} aria-label="Mara live briefing line">
        <div className="callTopline">
          <div className="callIdentity"><span>MV</span><div><b>Live with Mara</b><small><i /> {briefingCall.state.status}{briefingCall.state.activeTool ? ` · ${briefingCall.state.activeTool.replaceAll("_", " ")}` : ""}</small></div></div>
          <div className="waveform" aria-hidden="true">{Array.from({ length: 14 }, (_, index) => <i key={index} />)}</div>
        </div>
        <div className="callTranscript" aria-live="polite">
          {briefingCall.state.transcript.length === 0
            ? <p className="callWaiting">Your microphone will open when the briefing line is ready.</p>
            : briefingCall.state.transcript.map((line) => <p key={line.id} className={line.speaker}><b>{line.speaker === "mara" ? "MARA" : line.speaker === "you" ? "YOU" : "LINE"}</b><span>{line.text}</span></p>)}
        </div>
        {briefingCall.state.phase === "live" && <form className="callFallback" onSubmit={(event) => { event.preventDefault(); briefingCall.say(callText); setCallText(""); }}>
          <input value={callText} onChange={(event) => setCallText(event.target.value)} placeholder="Type into the live call…" />
          <button type="button" onClick={briefingCall.interrupt}>Interrupt</button><button disabled={!callText.trim()}>Send</button>
        </form>}
        {briefingCall.state.error && <div className="callError">{briefingCall.state.error}</div>}
      </section>}

      <section className="workStory" id="work" aria-labelledby="work-title">
        <header className="workHeader">
          <div><p className="sectionKicker">CURRENT CAMPAIGN</p><h2 id="work-title">{status}</h2></div>
          <div className="runState"><span className={`streamLamp ${streamState}`}><i />{streamState === "live" ? "Live updates" : streamState === "idle" ? "Ready" : "Connecting"}</span>{activeRunId && <small>Run {activeRunId.slice(0, 8)}</small>}</div>
          <div className="progressBlock"><div><span>Overall progress</span><b>{progress}%</b></div><div className="progressBar" aria-label={`${progress}% complete`}><i style={{ width: `${progress}%` }} /></div></div>
        </header>

        <div className={`nowCard ${phase}`}>
          <div className="nowPulse"><i /></div>
          <div><span>{phase === "idle" ? "What happens next" : phase === "done" ? "Campaign complete" : "Happening now"}</span><h3>{latestTelemetry?.title ?? (phase === "idle" ? "Mara is ready for your brief" : status)}</h3><p>{latestTelemetry?.detail ?? "Start a campaign and this page will show the work as it moves from one specialist to the next."}</p></div>
          {latestTelemetry?.agent && <b>{TEAM.find((member) => member.id === latestTelemetry.agent)?.name ?? "Mara"}</b>}
        </div>

        <ol className="journey" aria-label="Campaign workflow">
          {JOURNEY.map((step, index) => {
            const stepUpdates = telemetry.filter((item) => step.steps.includes(item.step as never));
            const last = stepUpdates.at(-1);
            const stepState = phase === "done" || index < currentJourneyIndex ? "complete" : index === currentJourneyIndex && phase !== "idle" ? "active" : "upcoming";
            return <li className={stepState} key={step.id}>
              <div className="stepMarker">{stepState === "complete" ? "✓" : index + 1}</div>
              <div className="stepCopy"><span>{step.agentName}</span><h3>{step.label}</h3><p>{last?.detail ?? step.description}</p>{last?.artifact && <a href={`#results`}>{last.artifact.split("/").at(-1)} ready →</a>}</div>
            </li>;
          })}
        </ol>

        {campaignBatches.length > 0 && <details className="campaignQueue">
          <summary>Campaigns launched from calls <span>{campaignBatches.length} batch{campaignBatches.length === 1 ? "" : "es"}</span></summary>
          {campaignBatches.slice(0, 3).map((batch) => <article className="campaignBatch" key={batch.runId}>
            <header><div><i className={batch.status} /><b>{batch.resolvedExecution.replace("dependency-waves", "dependency waves")}</b></div><small>{batch.status} · {batch.waves.length} wave{batch.waves.length === 1 ? "" : "s"}</small></header>
            <div className="campaignItems">{batch.items.map((item) => <div className={`campaignItem ${item.status}`} key={item.campaignId}><div><b>{item.name}</b><small>{item.status}{item.error ? ` · ${item.error}` : ""}</small></div>{item.runId ? <button className={activeRunId === item.runId ? "watching" : ""} onClick={() => watchCampaign(item.runId!)}>{activeRunId === item.runId ? "Viewing" : "View work"}</button> : <em>Queued</em>}</div>)}</div>
          </article>)}
        </details>}
      </section>

      <section className="collaboration" aria-label="Team collaboration">
        <div className="teamPanel">
          <div className="sectionHeading"><div><p className="sectionKicker">THE TEAM</p><h2>Who is doing what</h2></div><span>{TEAM.length} specialists</span></div>
          <div className="teamGrid">{agentStates.map(({ member, latest, state }) => <article className={`teamCard ${state}`} key={member.id}>
            <div className="avatar">{member.name.split(" ").map((part) => part[0]).join("")}</div><div><span>{state === "active" ? "Working now" : state === "complete" ? "Finished" : "Waiting"}</span><h3>{member.name}</h3><p>{member.role}</p>{latest && <small>{latest.title}</small>}</div>
          </article>)}</div>
        </div>

        <div className="collaborationGrid">
          <section className="handoffPanel">
            <div className="sectionHeading compact"><div><p className="sectionKicker">HANDOFFS</p><h2>How the work moves</h2></div><span>{exchangeCount}</span></div>
            {telemetry.filter((item) => item.kind === "mesh").length === 0
              ? <div className="friendlyEmpty"><b>No handoffs yet</b><p>When work starts, you’ll see who passed what to whom—and which file moved with it.</p></div>
              : <div className="handoffList">{telemetry.filter((item) => item.kind === "mesh").slice(-6).reverse().map((item, index) => <article key={`${item.at}-${index}`}><div><b>{TEAM.find((member) => member.id === item.agent)?.name ?? item.agent}</b><i>→</i><b>{TEAM.find((member) => member.id === item.peer)?.name ?? item.peer}</b><time>{clock(item.at)}</time></div><p>{item.detail}</p>{item.artifact && <code>{item.artifact}</code>}</article>)}</div>}
          </section>

          <section className="updatesPanel" aria-live="polite">
            <div className="sectionHeading compact"><div><p className="sectionKicker">WORK NOTES</p><h2>What changed</h2></div><span>{meaningfulUpdates.length}</span></div>
            {meaningfulUpdates.length === 0
              ? <div className="friendlyEmpty"><b>Nothing running yet</b><p>Useful milestones will appear here. Low-level runtime events stay out of the way.</p></div>
              : <div className="updateList">{meaningfulUpdates.map((item, index) => <article className={item.status} key={`${item.at}-${index}`}><i /><div><span>{TEAM.find((member) => member.id === item.agent)?.name ?? "Foundry"} · {clock(item.at)}</span><h3>{item.title}</h3><p>{item.detail}</p></div></article>)}</div>}
          </section>
        </div>
      </section>

      <section className="results" id="results" aria-labelledby="results-title">
        <div className="leadConversation">
          <div className="sectionHeading"><div><p className="sectionKicker">YOUR LEAD</p><h2 id="results-title">Mara’s recommendation</h2></div><span>{messages.length} messages</span></div>
          <div className="messages">{messages.map((message, index) => <div className={`message ${message.role}`} key={`${message.role}-${index}`}><b>{message.role === "assistant" ? "MARA" : "YOU"}</b><p>{message.text}</p></div>)}{(phase === "starting" || phase === "running") && <div className="message assistant thinking"><b>MARA</b><p><i /><i /><i /> Coordinating the team now.</p></div>}</div>
        </div>

        <aside className="artifactShelf">
          <div className="sectionHeading"><div><p className="sectionKicker">DELIVERABLES</p><h2>Files from the team</h2></div><span>{artifacts.length}</span></div>
          {artifacts.length === 0 ? <div className="friendlyEmpty tall"><b>No files yet</b><p>Research, strategy, creative direction, review, imagery, and the packaged brand system will appear here.</p></div> : <div className="artifactGrid">{artifacts.map((artifact) => <a key={artifact.path} href={artifact.href} target="_blank" rel="noreferrer" className={artifact.kind}>{artifact.kind === "image" ? <img src={artifact.href} alt="Generated brand key art" /> : <div className="docIcon"><i /><i /><i /></div>}<span><small>{artifact.kind} · {Math.max(1, Math.round(artifact.size / 1024))} kb</small><b>{artifact.name}</b></span><em>Open ↗</em></a>)}</div>}
        </aside>
      </section>

      <details className="technicalTrace">
        <summary><span>Developer trace</span><small>{foundryEvents.length} raw Foundry events · optional</small></summary>
        <div className="traceBody">
          <div className="eventFeed" role="log">{foundryEvents.length === 0 ? <div className="friendlyEmpty"><b>No runtime events</b><p>Start a campaign to inspect assembly, model, tool, mesh, and lifecycle events.</p></div> : foundryEvents.slice(-24).reverse().map((event) => <button className={selectedEvent?.sequence === event.sequence ? "selected" : ""} key={event.sequence} onClick={() => setSelectedSequence(event.sequence)}><time>{clock(event.timestamp)}</time><i className={event.category} /><span><b>{eventLabel(event)}</b><small>{event.category} · #{event.sequence}</small></span></button>)}</div>
          <aside className="eventDetail">{selectedEvent ? <><div><span>{selectedTelemetry ? "SAFE WORK NOTE" : "RUNTIME EVENT"}</span><b>#{selectedEvent.sequence}</b></div><h3>{eventLabel(selectedEvent)}</h3><p>{selectedTelemetry?.detail ?? "A framework lifecycle event emitted by Foundry."}</p>{selectedTelemetry?.artifact && <code>{selectedTelemetry.artifact}</code>}<dl><dt>Type</dt><dd>{selectedEvent.type}</dd><dt>Agent</dt><dd>{selectedTelemetry?.agent ?? selectedEvent.agent ?? "runtime"}</dd><dt>Time</dt><dd>{clock(selectedEvent.timestamp)}</dd></dl></> : <div className="friendlyEmpty"><b>Select an event</b><p>Technical correlation detail will appear here.</p></div>}<small>Work intent and outcomes only—not private hidden chain-of-thought.</small></aside>
        </div>
      </details>

      <footer><span>BRAIND STORM</span><span>One brief → five specialists → one accountable recommendation</span></footer>
    </main>
  );
}
