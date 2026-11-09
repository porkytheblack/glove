"use client";

// WebGL backdrops for the landing page, from Paper Shaders. Each one sits in
// an absolutely positioned layer behind real content, with a CSS gradient
// underneath so the page reads the same before the canvas mounts or where
// WebGL is unavailable. Motion stops for people who ask for reduced motion.

import { useEffect, useState } from "react";
import { useTheme, type Theme } from "@/components/theme-toggle";
import {
  Dithering,
  GrainGradient,
  StaticRadialGradient,
} from "@paper-design/shaders-react";

// Background ink per theme; matches --bg in globals.css.
const INK: Record<Theme, string> = { dark: "#080B0A", light: "#F6F8F7" };

/** Mix a hex colour toward white; light mode wants pastel washes, not dark blooms. */
function tint(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const [r, g, b] = [mix((n >> 16) & 255), mix((n >> 8) & 255), mix(n & 255)];
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
// Enough pixels for a sharp backdrop without paying for a full 4K canvas.
const MAX_PIXELS = 1920 * 1080;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

const fill = { position: "absolute", inset: 0, width: "100%", height: "100%" } as const;

/** Slow mint/amber grain behind the hero. */
export function HeroGrain() {
  const reduced = useReducedMotion();
  const theme = useTheme();
  return (
    <GrainGradient
      aria-hidden="true"
      style={fill}
      maxPixelCount={MAX_PIXELS}
      colorBack={INK[theme]}
      colors={
        theme === "light"
          ? ["#BFE3D0", "#9ED4B8", "#F1D6A8", "#CFC6F0"]
          : ["#2f6b55", "#9ED4B8", "#E4B879", "#5b4f9a"]
      }
      shape="corners"
      softness={0.8}
      intensity={0.4}
      noise={0.28}
      speed={reduced ? 0 : 0.4}
    />
  );
}

/** A still radial bloom; `hue` picks the card's colour. */
export function CardBloom({ hue }: { hue: string }) {
  const theme = useTheme();
  const light = theme === "light";
  return (
    <StaticRadialGradient
      aria-hidden="true"
      style={fill}
      maxPixelCount={900 * 600}
      colorBack={INK[theme]}
      colors={light ? [tint(hue, 0.72), "#FFFFFF"] : [hue, "#0F1613"]}
      radius={0.95}
      focalDistance={0.9}
      focalAngle={210}
      falloff={0.15}
      mixing={0.7}
      distortion={0.15}
      distortionShift={0}
      distortionFreq={12}
      grainMixer={0.35}
      grainOverlay={0.25}
      offsetX={0.45}
      offsetY={-0.55}
    />
  );
}

/** Ordered-dither waves behind the Foundry panel. */
export function FoundryDither() {
  const reduced = useReducedMotion();
  const theme = useTheme();
  return (
    <Dithering
      aria-hidden="true"
      style={fill}
      maxPixelCount={1280 * 720}
      colorBack={INK[theme]}
      colorFront={theme === "light" ? "#CFE9DB" : "#2f6b55"}
      shape="warp"
      type="4x4"
      size={2.5}
      speed={reduced ? 0 : 0.25}
      scale={0.9}
    />
  );
}

/** A wide grain wave for the closing call to action. */
export function ClosingGrain() {
  const reduced = useReducedMotion();
  const theme = useTheme();
  return (
    <GrainGradient
      aria-hidden="true"
      style={fill}
      maxPixelCount={1280 * 720}
      colorBack={INK[theme]}
      colors={theme === "light" ? ["#C8E8D7", "#C3DAF1", "#DCD3F5"] : ["#9ED4B8", "#83B3E2", "#B8A7E8"]}
      shape="wave"
      softness={0.75}
      intensity={0.3}
      noise={0.4}
      speed={reduced ? 0 : 0.3}
    />
  );
}
