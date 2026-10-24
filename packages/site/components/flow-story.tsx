"use client";

// A diagram you can step through. Each step lights the boxes and arrows it is
// about and sends a labelled packet along one arrow, so a reader sees what
// moves where, in order. It plays on its own once it scrolls into view, and
// holds still for anyone who prefers reduced motion. Every step's text is in
// the page as a numbered list, so it reads without the picture too.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

type Tone = "harness" | "system" | "production" | "neutral";

export interface StoryBox {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly title: string;
  readonly sub?: string;
  readonly tone?: Tone;
  readonly dashed?: boolean;
}

export interface StoryEdge {
  readonly id: string;
  /** SVG path data, drawn from start to end. */
  readonly d: string;
  readonly label?: string;
  readonly lx?: number;
  readonly ly?: number;
  readonly anchor?: "start" | "middle" | "end";
  readonly dashed?: boolean;
}

export interface StoryStep {
  /** Ids of boxes and edges this step is about. */
  readonly lit: ReadonlyArray<string>;
  /** A labelled packet that travels along one edge. */
  readonly packet?: { readonly edge: string; readonly label: string };
  readonly title: string;
  readonly text: ReactNode;
}

interface FlowStoryProps {
  /** Unique on the page: prefixes marker ids. */
  readonly id: string;
  readonly viewBox: string;
  /** What the whole picture shows, for screen readers. */
  readonly label: string;
  readonly boxes: ReadonlyArray<StoryBox>;
  readonly edges: ReadonlyArray<StoryEdge>;
  readonly steps: ReadonlyArray<StoryStep>;
  readonly caption?: ReactNode;
  readonly stepMs?: number;
}

function packetWidth(label: string): number {
  return Math.round(label.length * 6.7 + 18);
}

export function FlowStory({ id, viewBox, label, boxes, edges, steps, caption, stepMs = 3400 }: FlowStoryProps) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [still, setStill] = useState(false);
  const root = useRef<HTMLElement>(null);
  const touched = useRef(false);

  // Start playing the first time the figure is on screen, unless the reader
  // has asked for less motion or has already taken the controls.
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    setStill(reduced.matches);
    if (reduced.matches || !root.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !touched.current) {
          setPlaying(true);
          observer.disconnect();
        }
      },
      { threshold: 0.45 },
    );
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => {
      setStep((current) => (current + 1) % steps.length);
    }, step === steps.length - 1 ? stepMs * 1.6 : stepMs);
    return () => clearTimeout(timer);
  }, [playing, step, steps.length, stepMs]);

  const go = useCallback((next: number) => {
    touched.current = true;
    setPlaying(false);
    setStep((next + steps.length) % steps.length);
  }, [steps.length]);

  const current = steps[step]!;
  const lit = new Set(current.lit);
  const packetEdge = current.packet ? edges.find((edge) => edge.id === current.packet!.edge) : undefined;

  return (
    <figure className="dg-figure dg-wide fs" ref={root} aria-label={label}>
      <div className="dg-scroll">
        <svg viewBox={viewBox} role="img" aria-label={label} className="dg-svg fs-svg">
          <defs>
            <marker id={`${id}-off`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className="dg-arrowhead" />
            </marker>
            <marker id={`${id}-on`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className="dg-arrowhead on" />
            </marker>
          </defs>
          {edges.map((edge) => {
            const on = lit.has(edge.id);
            return (
              <g key={edge.id} className={`dg-edge fs-edge${on ? " on" : ""}${edge.dashed ? " dashed" : ""}`}>
                <path d={edge.d} fill="none" markerEnd={`url(#${id}-${on ? "on" : "off"})`} />
                {edge.label && edge.lx !== undefined && edge.ly !== undefined && (
                  <text x={edge.lx} y={edge.ly} textAnchor={edge.anchor ?? "middle"} className="dg-label">
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}
          {boxes.map((box) => {
            const on = lit.has(box.id);
            return (
              <g
                key={box.id}
                className={`dg-box fs-box tone-${box.tone ?? "neutral"}${on ? " on" : " rest"}${box.dashed ? " dashed" : ""}`}
              >
                <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={8} />
                <text x={box.x + box.w / 2} y={box.sub ? box.y + box.h / 2 - 3 : box.y + box.h / 2 + 5} textAnchor="middle" className="dg-title">
                  {box.title}
                </text>
                {box.sub && (
                  <text x={box.x + box.w / 2} y={box.y + box.h / 2 + 15} textAnchor="middle" className="dg-sub">
                    {box.sub}
                  </text>
                )}
              </g>
            );
          })}
          {current.packet && packetEdge && !still && (
            <g className="fs-packet" key={`${step}-${current.packet.edge}`}>
              <rect
                x={-packetWidth(current.packet.label) / 2}
                y={-11}
                width={packetWidth(current.packet.label)}
                height={22}
                rx={11}
              />
              <text x={0} y={4} textAnchor="middle">{current.packet.label}</text>
              <animateMotion dur="1.5s" fill="freeze" path={packetEdge.d} calcMode="spline" keyPoints="0;1" keyTimes="0;1" keySplines="0.4 0 0.2 1" />
            </g>
          )}
        </svg>
      </div>

      <div className="fs-controls">
        <button type="button" className="fs-button" onClick={() => go(step - 1)} aria-label="Previous step">←</button>
        <button
          type="button"
          className="fs-button fs-play"
          onClick={() => {
            touched.current = true;
            setPlaying((value) => !value);
          }}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <button type="button" className="fs-button" onClick={() => go(step + 1)} aria-label="Next step">→</button>
        <span className="fs-count">
          {step + 1} / {steps.length}
        </span>
      </div>

      <ol className="fs-steps">
        {steps.map((item, index) => (
          <li key={item.title} className={index === step ? "on" : undefined} aria-current={index === step ? "step" : undefined}>
            <button type="button" onClick={() => go(index)}>
              <span className="fs-step-title">{item.title}</span>
            </button>
            <div className="fs-step-text">{item.text}</div>
          </li>
        ))}
      </ol>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}
