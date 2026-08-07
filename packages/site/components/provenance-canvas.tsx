/**
 * Provenance canvas — draws how one image was actually made.
 *
 * Library nodes (characters, scene, house style) feed a pipeline spine
 * (one node per enhancer that ran), which produces the final prompt, which
 * produces the image. Edges are real: every node is read from the asset's
 * recorded Recipe, not from a hand-drawn diagram.
 *
 * Pure SVG + CSS, no client JS — it renders in the static export and stays
 * legible at any width because the layout is a viewBox, not pixels.
 */

interface Node {
  id: string;
  label: string;
  body?: string;
  kind: "character" | "scene" | "style" | "stage" | "prompt" | "image";
}

export interface ProvenanceInput {
  characters: Array<{ name: string; display_name: string; appearance: string }>;
  scene?: { label: string; setting: string };
  houseStyle?: string;
  trace: Array<{ enhancer: string; note?: string }>;
  finalPrompt: string;
  image: { file: string; title: string };
  costUsd: number;
}

const W = 1000;
const COL = { source: 30, stage: 330, prompt: 600, image: 830 };
const CARD = { source: 250, stage: 220, prompt: 200 };

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Wrap text into lines of roughly `per` characters. */
function wrap(text: string, per: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > per) {
      lines.push(line.trim());
      line = word;
      if (lines.length === maxLines) break;
    } else {
      line = `${line} ${word}`;
    }
  }
  if (lines.length < maxLines && line.trim()) lines.push(line.trim());
  if (lines.length === maxLines) {
    const last = lines[maxLines - 1]!;
    if (last.length + 1 < text.length) lines[maxLines - 1] = truncate(last, per);
  }
  return lines;
}

/** Chars per line and height must agree between layout and render, so both
    go through these two helpers rather than being recomputed inline. */
const perLine = (w: number) => Math.floor(w / 5.6);
function cardHeight(body: string | undefined, w: number, maxLines: number): number {
  const n = body ? wrap(body, perLine(w), maxLines).length : 0;
  return 30 + n * 13 + (n ? 8 : 0);
}

function Card({
  x,
  y,
  w,
  node,
  maxLines = 3,
}: {
  x: number;
  y: number;
  w: number;
  node: Node;
  maxLines?: number;
}) {
  const bodyLines = node.body ? wrap(node.body, perLine(w), maxLines) : [];
  const h = 30 + bodyLines.length * 13 + (bodyLines.length ? 8 : 0);
  const accent =
    node.kind === "character"
      ? "var(--pc-character)"
      : node.kind === "scene"
        ? "var(--pc-scene)"
        : node.kind === "style"
          ? "var(--pc-style)"
          : node.kind === "prompt"
            ? "var(--pc-prompt)"
            : "var(--pc-stage)";

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={7}
        fill="var(--pc-card)"
        stroke={accent}
        strokeWidth={1}
      />
      <rect x={x} y={y} width={3} height={h} rx={1.5} fill={accent} />
      <text
        x={x + 13}
        y={y + 19}
        fill="var(--pc-label)"
        fontSize={11.5}
        fontFamily="var(--mono, ui-monospace, monospace)"
      >
        {truncate(node.label, Math.floor(w / 6.4))}
      </text>
      {bodyLines.map((line, i) => (
        <text
          key={i}
          x={x + 13}
          y={y + 36 + i * 13}
          fill="var(--pc-body)"
          fontSize={10}
          fontFamily="var(--sans, ui-sans-serif, system-ui)"
        >
          {line}
        </text>
      ))}
    </g>
  );
}

/** Orthogonal elbow connector — reads as wiring rather than a scribble. */
function Edge({
  x1,
  y1,
  x2,
  y2,
  dim,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  dim?: boolean;
}) {
  const mid = x1 + (x2 - x1) / 2;
  return (
    <path
      d={`M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`}
      fill="none"
      stroke={dim ? "var(--pc-edge-dim)" : "var(--pc-edge)"}
      strokeWidth={1}
      markerEnd="url(#pc-arrow)"
    />
  );
}

export function ProvenanceCanvas({ data }: { data: ProvenanceInput }) {
  // ── sources column
  const sources: Node[] = [
    ...data.characters.map((c) => ({
      id: `char-${c.name}`,
      label: `character · ${c.name}`,
      body: c.appearance,
      kind: "character" as const,
    })),
    ...(data.scene
      ? [
          {
            id: "scene",
            label: `scene · ${data.scene.label}`,
            body: data.scene.setting,
            kind: "scene" as const,
          },
        ]
      : []),
    ...(data.houseStyle
      ? [{ id: "style", label: "styleDirective", body: data.houseStyle, kind: "style" as const }]
      : []),
  ];

  const SOURCE_LINES = 4;
  const STAGE_LINES = 2;
  const PROMPT_LINES = 9;

  const sourceH = (n: Node) => cardHeight(n.body, CARD.source, SOURCE_LINES);
  const sourceYs: number[] = [];
  let cursor = 10;
  for (const n of sources) {
    sourceYs.push(cursor);
    cursor += sourceH(n) + 12;
  }
  const sourcesBottom = cursor;

  // ── pipeline spine
  const stages = data.trace;
  const stageH = (t: { note?: string }) => cardHeight(t.note, CARD.stage, STAGE_LINES);
  const stageTotal = stages.reduce((sum, t) => sum + stageH(t) + 12, 0);
  const stageStart = Math.max(10, (sourcesBottom - stageTotal) / 2);
  const stageYs: number[] = [];
  cursor = stageStart;
  for (const t of stages) {
    stageYs.push(cursor);
    cursor += stageH(t) + 12;
  }

  const height = Math.max(sourcesBottom, cursor, 300) + 10;
  const midY = height / 2;

  const promptH = cardHeight(data.finalPrompt, CARD.prompt, PROMPT_LINES);
  const promptY = midY - promptH / 2;

  const imgSize = 168;
  const imgY = midY - imgSize / 2;

  return (
    <div className="pc-wrap">
      <svg viewBox={`0 0 ${W} ${height}`} className="pc-svg" role="img"
        aria-label={`Provenance graph for ${data.image.title}: library definitions feed the prompt pipeline, which produces the final prompt and the image.`}>
        <defs>
          <marker id="pc-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M 0 1 L 7 4 L 0 7 z" fill="var(--pc-edge)" />
          </marker>
        </defs>

        {/* column captions */}
        <text x={COL.source} y={height - 2} fill="var(--pc-caption)" fontSize={9.5} fontFamily="var(--mono, monospace)">
          library — defined once
        </text>
        <text x={COL.stage} y={height - 2} fill="var(--pc-caption)" fontSize={9.5} fontFamily="var(--mono, monospace)">
          pipeline — ran in order
        </text>
        <text x={COL.prompt} y={height - 2} fill="var(--pc-caption)" fontSize={9.5} fontFamily="var(--mono, monospace)">
          final prompt
        </text>
        <text x={COL.image} y={height - 2} fill="var(--pc-caption)" fontSize={9.5} fontFamily="var(--mono, monospace)">
          ${data.costUsd.toFixed(4)}
        </text>

        {/* sources → first stage */}
        {sources.map((n, i) => {
          const y = sourceYs[i]! + sourceH(n) / 2;
          const targetIdx = n.kind === "character" ? 0 : n.kind === "scene" ? Math.min(1, stages.length - 1) : Math.min(2, stages.length - 1);
          const ty = (stageYs[targetIdx] ?? stageStart) + stageH(stages[targetIdx] ?? {}) / 2;
          return (
            <Edge key={`e-${n.id}`} x1={COL.source + CARD.source} y1={y} x2={COL.stage} y2={ty} dim />
          );
        })}

        {/* stage → stage */}
        {stages.map((t, i) =>
          i < stages.length - 1 ? (
            <Edge
              key={`s-${i}`}
              x1={COL.stage + CARD.stage / 2}
              y1={stageYs[i]! + stageH(t)}
              x2={COL.stage + CARD.stage / 2}
              y2={stageYs[i + 1]!}
            />
          ) : null,
        )}

        {/* last stage → prompt → image */}
        {stages.length > 0 && (
          <Edge
            x1={COL.stage + CARD.stage}
            y1={stageYs[stages.length - 1]! + stageH(stages[stages.length - 1]!) / 2}
            x2={COL.prompt}
            y2={midY}
          />
        )}
        <Edge x1={COL.prompt + CARD.prompt} y1={midY} x2={COL.image} y2={midY} />

        {/* nodes */}
        {sources.map((n, i) => (
          <Card key={n.id} x={COL.source} y={sourceYs[i]!} w={CARD.source} node={n} maxLines={SOURCE_LINES} />
        ))}
        {stages.map((t, i) => (
          <Card
            key={`stage-${i}`}
            x={COL.stage}
            y={stageYs[i]!}
            w={CARD.stage}
            node={{ id: `stage-${i}`, label: t.enhancer, body: t.note, kind: "stage" }}
            maxLines={STAGE_LINES}
          />
        ))}
        <Card
          x={COL.prompt}
          y={promptY}
          w={CARD.prompt}
          node={{ id: "prompt", label: "prompt → model", body: data.finalPrompt, kind: "prompt" }}
          maxLines={PROMPT_LINES}
        />

        <image
          href={`/image-gallery/${data.image.file}`}
          x={COL.image}
          y={imgY}
          width={imgSize}
          height={imgSize}
          preserveAspectRatio="xMidYMid slice"
          clipPath="inset(0 round 8px)"
        />
        <rect
          x={COL.image}
          y={imgY}
          width={imgSize}
          height={imgSize}
          rx={8}
          fill="none"
          stroke="var(--pc-edge)"
          strokeWidth={1}
        />
      </svg>
    </div>
  );
}
