// Diagrams for the docs. Structural pictures (the layer nesting, blueprints,
// the build ladder) are HTML so they reflow on a phone; mechanism pictures
// (the loop, how a Foundry run starts, a Kuiper project) are SVG with a fixed
// viewBox inside a scroll container. Colours come from globals.css (`.dg-*`):
// mint for the harness (Glove), blue for the system (Foundry), violet for
// production (Kuiper), everywhere.

import Link from "next/link";
import type { ReactNode } from "react";
import {
  layers,
  parts,
  partsOf,
  primitives,
  type LayerId,
  type PartId,
} from "@/lib/primitives";

// ─── shared ────────────────────────────────────────────────────────────────

function Figure({ caption, children, wide }: { caption: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <figure className={`dg-figure${wide ? " dg-wide" : ""}`}>
      {children}
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

// Marker ids are per diagram (`m`) so two diagrams on one page never share an id.
function ArrowDefs({ m }: { m: string }) {
  return (
    <defs>
      <marker id={`${m}-off`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" className="dg-arrowhead" />
      </marker>
      <marker id={`${m}-on`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" className="dg-arrowhead on" />
      </marker>
    </defs>
  );
}

interface BoxProps {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  sub?: string;
  tone?: LayerId | "neutral";
  on?: boolean;
  dim?: boolean;
  dashed?: boolean;
}

function Box({ x, y, w, h, title, sub, tone = "neutral", on, dim, dashed }: BoxProps) {
  const cls = ["dg-box", `tone-${tone}`, on ? "on" : "", dim ? "dim" : "", dashed ? "dashed" : ""].filter(Boolean).join(" ");
  const cx = x + w / 2;
  return (
    <g className={cls}>
      <rect x={x} y={y} width={w} height={h} rx={8} />
      <text x={cx} y={sub ? y + h / 2 - 3 : y + h / 2 + 5} textAnchor="middle" className="dg-title">
        {title}
      </text>
      {sub && (
        <text x={cx} y={y + h / 2 + 15} textAnchor="middle" className="dg-sub">
          {sub}
        </text>
      )}
    </g>
  );
}

interface EdgeProps {
  m: string;
  d: string;
  label?: string;
  lx?: number;
  ly?: number;
  anchor?: "start" | "middle" | "end";
  on?: boolean;
  dim?: boolean;
  both?: boolean;
  dashed?: boolean;
}

function Edge({ m, d, label, lx, ly, anchor = "middle", on, dim, both, dashed }: EdgeProps) {
  const cls = ["dg-edge", on ? "on" : "", dim ? "dim" : "", dashed ? "dashed" : ""].filter(Boolean).join(" ");
  const marker = on ? `url(#${m}-on)` : `url(#${m}-off)`;
  return (
    <g className={cls}>
      <path d={d} fill="none" markerEnd={marker} markerStart={both ? marker : undefined} />
      {label && lx !== undefined && ly !== undefined && (
        <text x={lx} y={ly} textAnchor={anchor} className="dg-label">
          {label}
        </text>
      )}
    </g>
  );
}

// ─── the three layers, nested ──────────────────────────────────────────────

/**
 * Production wraps the system, which wraps the harness. Each layer lists the
 * parts it adds; every part links to its row in the primitives map.
 */
export function LayerStack({ caption }: { caption?: ReactNode }) {
  const order: LayerId[] = ["production", "system", "harness"];
  const render = (index: number): ReactNode => {
    const layer = layers.find((entry) => entry.id === order[index])!;
    return (
      <div className={`dg-layer tone-${layer.id}`}>
        <div className="dg-layer-head">
          <span className="dg-layer-name">{layer.name}</span>
          <span className="dg-layer-owner">{layer.owner}</span>
        </div>
        <div className="dg-chips">
          {partsOf(layer.id).map((part) => (
            <Link key={part.id} href={`/docs/primitives#${part.id}`} className="dg-chip">
              {part.name}
            </Link>
          ))}
        </div>
        {index < order.length - 1 && render(index + 1)}
      </div>
    );
  };
  return (
    <Figure
      caption={
        caption ??
        "Three layers, each wrapping the one inside it. Glove is the harness around a model, Foundry turns harnesses into a running system, and Kuiper runs that system in production. Each name is a part you would otherwise build yourself; click one for its primitives."
      }
    >
      <div className="dg-stack" role="img" aria-label="Kuiper production wraps the Glove Foundry system, which wraps the Glove harness">
        {render(0)}
      </div>
    </Figure>
  );
}

// ─── the harness: where each part attaches to the loop ─────────────────────

/**
 * The loop as it actually runs: the message is saved to state, context is
 * assembled from state, the model asks for tools, results are saved, repeat.
 * Pass `highlight` to light up one part (used by the build-up guide).
 */
export function HarnessDiagram({ highlight, caption }: { highlight?: PartId; caption?: ReactNode }) {
  const lit = (part: PartId) => highlight === part;
  const dim = (part: PartId) => highlight !== undefined && highlight !== part && !(highlight === "loop" && (part === "context" || part === "state" || part === "tools"));
  const loopOn = highlight === "loop";
  return (
    <Figure
      wide
      caption={
        caption ??
        "One request through a Glove harness. The message is saved to state; context is assembled from state before every model call; the model asks for tools; results are saved; the cycle repeats until the model answers. Tools can render UI on the surface and wait for a reply, act on a workspace, or hand work to a subagent."
      }
    >
      <div className="dg-scroll">
        <svg viewBox="0 0 820 420" role="img" aria-label="The Glove loop: state, context, model and tools in a cycle, with surface, workspace and team attached to it" className="dg-svg">
          <ArrowDefs m="dgh" />
          <Box x={16} y={60} w={120} h={290} title="Surface" sub="chat · voice · API" tone="harness" on={lit("surface")} dim={dim("surface")} />
          <Box x={196} y={70} w={180} h={70} title="Context" sub="prompt · history · live state" tone="harness" on={lit("context") || loopOn} dim={dim("context")} />
          <Box x={456} y={70} w={180} h={70} title="Model" sub="any provider" tone="harness" on={loopOn} dim={highlight !== undefined && !loopOn} />
          <Box x={196} y={250} w={180} h={70} title="State" sub="store · memory · inbox" tone="harness" on={lit("state") || loopOn} dim={dim("state")} />
          <Box x={456} y={250} w={180} h={70} title="Tools" sub="validated · gated" tone="harness" on={lit("tools") || loopOn} dim={dim("tools")} />
          <Box x={690} y={70} w={120} h={70} title="Team" sub="subagents · mesh" tone="harness" on={lit("team")} dim={dim("team")} />
          <Box x={690} y={250} w={120} h={70} title="Workspace" sub="files · code · web" tone="harness" on={lit("workspace")} dim={dim("workspace")} />

          <text x={416} y={192} textAnchor="middle" className={`dg-loop-label${loopOn ? " on" : ""}`}>loop</text>
          <text x={416} y={208} textAnchor="middle" className="dg-sub">until the model answers</text>

          <Edge m="dgh" d="M376,105 L452,105" label="prompt" lx={414} ly={97} on={loopOn || lit("context")} />
          <Edge m="dgh" d="M546,140 L546,246" label="tool calls" lx={556} ly={198} anchor="start" on={loopOn || lit("tools")} />
          <Edge m="dgh" d="M456,285 L380,285" label="results" lx={416} ly={277} on={loopOn || lit("state")} />
          <Edge m="dgh" d="M286,250 L286,144" label="history" lx={276} ly={198} anchor="end" on={loopOn || lit("context") || lit("state")} />
          <Edge m="dgh" d="M136,285 L192,285" label="message" lx={166} ly={277} on={lit("surface")} dim={highlight !== undefined && !lit("surface")} />
          <Edge m="dgh" d="M546,70 L546,30 L76,30 L76,56" label="answer" lx={311} ly={24} on={lit("surface")} dim={highlight !== undefined && !lit("surface")} />
          <Edge m="dgh" d="M546,320 L546,382 L76,382 L76,354" label="display stack: show · ask · wait" lx={311} ly={398} on={lit("surface")} dim={highlight !== undefined && !lit("surface")} both />
          <Edge m="dgh" d="M636,262 L702,144" label="a subagent is a tool" lx={676} ly={210} anchor="start" on={lit("team")} dim={highlight !== undefined && !lit("team")} />
          <Edge m="dgh" d="M636,295 L686,295" label="acts on" lx={663} ly={287} on={lit("workspace")} dim={highlight !== undefined && !lit("workspace")} />
        </svg>
      </div>
    </Figure>
  );
}

// ─── the system: three ways in, one run, three ways out ────────────────────

export function SystemDiagram({ caption }: { caption?: ReactNode }) {
  return (
    <Figure
      wide
      caption={
        caption ??
        "How work reaches a Foundry agent and what comes out. Events from the outside world pass through a transmission and a playbook, which may create the instance that handles them; schedules wake an instance on their own; clients send messages into a conversation. Every run assembles a fresh Glove from the definition, the instance and the message, in its own process."
      }
    >
      <div className="dg-scroll">
        <svg viewBox="0 0 880 450" role="img" aria-label="Foundry: events, schedules and clients reach instances and conversations, which start runs that reply, ask for approval and emit events" className="dg-svg">
          <ArrowDefs m="dgs" />
          <Box x={16} y={40} w={160} h={60} title="Outside world" sub="Slack · email · webhooks" />
          <Box x={246} y={40} w={160} h={60} title="Transmission" sub="verify · normalise" tone="system" />
          <Box x={476} y={40} w={160} h={60} title="Playbook" sub="match · provision" tone="system" />
          <Box x={16} y={170} w={160} h={60} title="Schedules" sub="cron · interval · sleep" tone="system" />
          <Box x={476} y={170} w={160} h={60} title="Instance" sub="definition + data" tone="system" />
          <Box x={16} y={300} w={160} h={60} title="Client" sub="typed · REST · OpenAI" />
          <Box x={246} y={300} w={160} h={60} title="Conversation" sub="durable thread" tone="system" />
          <Box x={476} y={300} w={160} h={60} title="Run" sub="a fresh Glove per run" tone="harness" />
          <Box x={736} y={236} w={130} h={52} title="Reply" sub="outbound tool" tone="system" />
          <Box x={736} y={304} w={130} h={52} title="Approval" sub="pause · approve · deny" tone="system" />
          <Box x={736} y={372} w={130} h={52} title="Inspector" sub="every run and call" tone="system" />

          <Edge m="dgs" d="M176,70 L242,70" label="event" lx={211} ly={62} />
          <Edge m="dgs" d="M406,70 L472,70" label="typed" lx={441} ly={62} />
          <Edge m="dgs" d="M556,100 L556,166" label="routes · creates" lx={566} ly={138} anchor="start" />
          <Edge m="dgs" d="M176,200 L472,200" label="activation" lx={324} ly={192} />
          <Edge m="dgs" d="M176,330 L242,330" label="message" lx={211} ly={322} />
          <Edge m="dgs" d="M406,330 L472,330" label="history" lx={441} ly={322} />
          <Edge m="dgs" d="M556,230 L556,296" label="assembles" lx={566} ly={268} anchor="start" />
          <Edge m="dgs" d="M636,330 L676,330 L676,262 L732,262" label="replies" lx={704} ly={255} />
          <Edge m="dgs" d="M636,330 L732,330" label="asks" lx={704} ly={323} />
          <Edge m="dgs" d="M636,330 L676,330 L676,398 L732,398" label="emits" lx={704} ly={391} />
        </svg>
      </div>
    </Figure>
  );
}

// ─── production: a Foundry agent in a Kuiper project ───────────────────────

export function ProductionDiagram({ caption }: { caption?: ReactNode }) {
  return (
    <Figure
      wide
      caption={
        caption ??
        "A Foundry agent on Kuiper. The unit is built from your folder or repository and served over HTTPS; Foundry's data, transcripts and memory live on its /data disk; databases and secrets are wired in by variable templates; one gateway key reaches the model providers, browsers, sandboxes and inbox. The dashboard reads the agent's runs through the node, without your app's token leaving Kuiper."
      }
    >
      <div className="dg-scroll">
        <svg viewBox="0 0 860 450" role="img" aria-label="A Kuiper project: users reach a Foundry unit over HTTPS; the unit uses a /data disk, databases, secrets and the gateway for models, browsers, sandboxes and inbox; the dashboard reads its runs" className="dg-svg">
          <ArrowDefs m="dgp" />
          <g className="dg-group tone-production">
            <rect x={186} y={24} width={370} height={330} rx={12} />
            <text x={202} y={46} className="dg-group-label">Kuiper project</text>
          </g>
          <g className="dg-group tone-production">
            <rect x={626} y={24} width={220} height={330} rx={12} />
            <text x={642} y={46} className="dg-group-label">Kuiper gateway</text>
          </g>

          <Box x={16} y={140} w={130} h={60} title="People · apps" sub="your domain" />
          <Box x={212} y={130} w={180} h={80} title="Foundry unit" sub="glove foundry start" tone="system" />
          <Box x={212} y={262} w={180} h={64} title="/data disk" sub="data · transcripts · VFS" tone="production" />
          <Box x={436} y={130} w={100} h={60} title="Postgres" sub="Redis · buckets" tone="production" />
          <Box x={436} y={262} w={100} h={64} title="Secrets" sub="sealed" tone="production" />
          <Box x={644} y={64} w={184} h={56} title="Models" sub="your provider keys" tone="production" />
          <Box x={644} y={134} w={184} h={56} title="Browsers" sub="real Chrome" tone="production" />
          <Box x={644} y={204} w={184} h={56} title="Sandboxes" sub="kuiper/coding …" tone="production" />
          <Box x={644} y={274} w={184} h={56} title="Inbox" sub="email in and out" tone="production" />
          <Box x={186} y={388} w={660} h={48} title="Dashboard · CLI · MCP" sub="logs · runs · model calls · usage · budgets" />

          <Edge m="dgp" d="M146,170 L208,170" label="HTTPS" lx={177} ly={162} />
          <Edge m="dgp" d="M302,210 L302,258" label="reads · writes" lx={312} ly={240} anchor="start" />
          <Edge m="dgp" d="M392,160 L432,160" both />
          <Edge m="dgp" d="M446,262 L396,206" label="variables" lx={432} ly={232} anchor="start" />
          <Edge m="dgp" d="M556,190 L622,190" label="one key" lx={589} ly={182} both />
          <Edge m="dgp" d="M380,388 L380,358" label="reads runs and logs" lx={390} ly={378} anchor="start" />
        </svg>
      </div>
    </Figure>
  );
}

// ─── Foundry: agent.ts assembles, other modules hold the parts ─────────────

const ASSEMBLY_PARTS: ReadonlyArray<{ file: string; role: string }> = [
  { file: "prompt.ts", role: "who it is, how it talks" },
  { file: "tools.ts", role: "what it can do" },
  { file: "personal.memory.ts", role: "what it remembers" },
  { file: "workspace.ts", role: "where it works" },
  { file: "call.ts", role: "how it takes calls" },
  { file: "lib/models.ts", role: "which model, per layer" },
];

/**
 * agent.ts is where a definition is put together, not where its parts live.
 * Each part is its own module; Foundry assembles the result per run.
 */
export function AssemblyDiagram({ caption }: { caption?: ReactNode }) {
  const top = 22;
  const gap = 52;
  const bus = 236;
  const mid = top + (gap * (ASSEMBLY_PARTS.length - 1)) / 2 + 20;
  return (
    <Figure
      wide
      caption={
        caption ??
        "agent.ts imports the parts and wires them into fields. The parts are plain modules you can read, test and reuse on their own; a function in a field runs per run, with that run's instance and message. Foundry then assembles a fresh Glove for each run."
      }
    >
      <div className="dg-scroll">
        <svg viewBox="0 0 880 340" role="img" aria-label="Six modules (prompt, tools, memory, workspace, call, models) feed agent.ts, which Foundry assembles into a fresh Glove for each run" className="dg-svg">
          <ArrowDefs m="dga" />
          {ASSEMBLY_PARTS.map((part, index) => (
            <g key={part.file}>
              <Box x={16} y={top + index * gap} w={180} h={40} title={part.file} sub={part.role} />
              <g className="dg-edge">
                <path d={`M196,${top + index * gap + 20} L${bus},${top + index * gap + 20} L${bus},${mid}`} fill="none" />
              </g>
            </g>
          ))}
          <Edge m="dga" d={`M${bus},${mid} L316,${mid}`} label="imports" lx={276} ly={mid - 8} />
          <Box x={320} y={mid - 45} w={170} h={90} title="agent.ts" sub="defineAgent: assembly only" tone="system" on />
          <Edge m="dga" d={`M490,${mid} L566,${mid}`} label="per run" lx={528} ly={mid - 8} />
          <Box x={570} y={mid - 45} w={170} h={90} title="Foundry" sub="+ instance + message" tone="system" />
          <Edge m="dga" d={`M740,${mid} L766,${mid}`} />
          <Box x={770} y={mid - 45} w={100} h={90} title="a Glove" sub="for this run" tone="harness" />
        </svg>
      </div>
    </Figure>
  );
}

// ─── Foundry: what an application bundles, and who installs it ─────────────

export function AppAnatomy({ caption }: { caption?: ReactNode }) {
  return (
    <Figure
      wide
      caption={
        caption ??
        "An application is code: transmissions (how events arrive and replies leave), optional connections (a socket or poller Foundry supervises) and extra tools. Instances install it, and only installed instances get its tools. Accounts, routes and bindings are data: which external account, which queue, and who may send."
      }
    >
      <div className="dg-scroll">
        <svg viewBox="0 0 880 330" role="img" aria-label="An application bundles transmissions, connections and tools; instances install it; topology data says which accounts and routes it may use" className="dg-svg">
          <ArrowDefs m="dgapp" />
          <g className="dg-group tone-system">
            <rect x={16} y={18} width={460} height={190} rx={12} />
            <text x={32} y={40} className="dg-group-label">apps/helpdesk.app.ts · code</text>
          </g>
          <Box x={36} y={56} w={200} h={64} title="Transmission" sub="events · schemas · adapters" tone="system" />
          <Box x={256} y={56} w={200} h={64} title="Connection" sub="socket or poller (optional)" tone="system" />
          <Box x={36} y={132} w={420} h={56} title="Tools" sub="one outbound tool per transmission, plus your own" tone="system" />

          <Box x={600} y={30} w={260} h={50} title="Instance: acme-support" sub="installed" tone="system" on />
          <Box x={600} y={92} w={260} h={50} title="Instance: globex-support" sub="installed" tone="system" on />
          <Box x={600} y={154} w={260} h={50} title="Instance: internal-ops" sub="not installed: no tools" tone="system" dim />
          <Edge m="dgapp" d="M476,90 L596,55" label="installs" lx={530} ly={62} />
          <Edge m="dgapp" d="M476,110 L596,117" />

          <g className="dg-group tone-neutral">
            <rect x={16} y={238} width={844} height={76} rx={12} />
            <text x={32} y={258} className="dg-group-label">topology · data with ids</text>
          </g>
          <Box x={150} y={266} w={180} h={40} title="Accounts" sub="credential refs" />
          <Box x={350} y={266} w={180} h={40} title="Routes" sub="inbound · outbound" />
          <Box x={550} y={266} w={180} h={40} title="Bindings" sub="who may use which route" />
          <Edge m="dgapp" d="M440,264 L440,212" label="authorise" lx={448} ly={244} anchor="start" dashed />
        </svg>
      </div>
    </Figure>
  );
}

// ─── blueprint: which primitives a harness uses ────────────────────────────

/**
 * A bill of materials. `uses` names primitives from lib/primitives.ts; every
 * part of the three layers is shown, lit if the blueprint uses something
 * from it. `write` lists what the builder writes themselves.
 */
export function Blueprint({ uses, write, caption }: { uses: string[]; write: string[]; caption?: ReactNode }) {
  const known = new Set(primitives.map((primitive) => primitive.name));
  for (const name of uses) {
    if (!known.has(name)) throw new Error(`Blueprint: unknown primitive "${name}"`);
  }
  const used = new Set(uses);
  return (
    <Figure
      caption={
        caption ??
        `This harness uses ${uses.length} primitives across ${new Set(primitives.filter((p) => used.has(p.name)).map((p) => p.part)).size} parts. Everything listed is already built; the dashed box is what you write.`
      }
    >
      <div className="dg-blueprint" role="img" aria-label={`Primitives used: ${uses.join(", ")}. You write: ${write.join(", ")}.`}>
        <div className="dg-bp-layers">
          {layers.map((layer) => (
            <div key={layer.id} className={`dg-bp-layer tone-${layer.id}`}>
              <div className="dg-layer-head">
                <span className="dg-layer-name">{layer.name}</span>
                <span className="dg-layer-owner">{layer.owner}</span>
              </div>
              {partsOf(layer.id)
                .filter((part) => primitives.some((p) => p.part === part.id && used.has(p.name)))
                .map((part) => (
                  <div key={part.id} className="dg-bp-part on">
                    <span className="dg-bp-part-name">{part.name}</span>
                    <span className="dg-bp-items">
                      {primitives
                        .filter((p) => p.part === part.id && used.has(p.name))
                        .map((item) => (
                          <Link key={item.name} href={item.href} className="dg-bp-item">
                            {item.name}
                          </Link>
                        ))}
                    </span>
                  </div>
                ))}
              {(() => {
                const unused = partsOf(layer.id).filter((part) => !primitives.some((p) => p.part === part.id && used.has(p.name)));
                return unused.length ? (
                  <div className="dg-bp-part dg-bp-unused">
                    <span className="dg-bp-part-name">Not needed</span>
                    <span className="dg-bp-items">{unused.map((part) => part.name).join(" · ")}</span>
                  </div>
                ) : null;
              })()}
            </div>
          ))}
        </div>
        <div className="dg-bp-write">
          <span className="dg-layer-name">You write</span>
          <ul>
            {write.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
    </Figure>
  );
}

// ─── the build-up guide, as a ladder ───────────────────────────────────────

export interface LadderStep {
  href: string;
  title: string;
  adds: string;
  layer: LayerId;
}

export const buildSteps: LadderStep[] = [
  { href: "/docs/build/loop", title: "A loop and a tool", adds: "Loop · Tools", layer: "harness" },
  { href: "/docs/build/surface", title: "Show your work", adds: "Surface", layer: "harness" },
  { href: "/docs/build/context", title: "Control what it sees", adds: "Context", layer: "harness" },
  { href: "/docs/build/state", title: "Make it remember", adds: "State", layer: "harness" },
  { href: "/docs/build/workspace", title: "Give it a workspace", adds: "Workspace", layer: "harness" },
  { href: "/docs/build/team", title: "Split the work", adds: "Team", layer: "harness" },
  { href: "/docs/build/system", title: "Make it a system", adds: "Identity · Time · Arrival · Oversight · Access", layer: "system" },
  { href: "/docs/build/production", title: "Put it in production", adds: "Run · Keep · Reach · Watch", layer: "production" },
];

export function BuildLadder({ current }: { current?: string }) {
  return (
    <ol className="dg-ladder">
      {buildSteps.map((step, index) => (
        <li key={step.href} className={`tone-${step.layer}${current === step.href ? " on" : ""}`}>
          <Link href={step.href}>
            <span className="dg-ladder-n">{String(index + 1).padStart(2, "0")}</span>
            <span className="dg-ladder-title">{step.title}</span>
            <span className="dg-ladder-adds">{step.adds}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

// ─── a compact list of the parts, for the first-principles page ─────────────

export function PartQuestions({ layer }: { layer: LayerId }) {
  return (
    <div className={`dg-questions tone-${layer}`}>
      {parts
        .filter((part) => part.layer === layer)
        .map((part) => (
          <Link key={part.id} href={`/docs/primitives#${part.id}`} className="dg-question">
            <span className="dg-question-name">{part.name}</span>
            <span className="dg-question-q">{part.question}</span>
            <span className="dg-question-a">{part.answer}</span>
          </Link>
        ))}
    </div>
  );
}
