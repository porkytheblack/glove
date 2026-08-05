/**
 * Drawing a deck's layout without LibreOffice.
 *
 * This is **not** a faithful render and must never be mistaken for one. It
 * has no theme colours, no fonts from the deck, no charts, no SmartArt, no
 * master-slide inheritance. What it does have is every shape's real frame and
 * real text, drawn to scale.
 *
 * That is enough for the failures worth catching, all of which are
 * positional:
 *
 * - a text box wider than the slide, or hanging off its edge
 * - two shapes on top of each other
 * - text that cannot fit the box it is in
 * - a slide with nothing on it
 *
 * None of those are visible to text extraction, and all of them survive into
 * the real render. A schematic that catches them is worth more than no check
 * at all — which is what a host without LibreOffice otherwise has.
 *
 * So the output is deliberately drawn to *look* like a diagram: outlined
 * boxes, one typeface, and a caption saying what it is. A vision model asked
 * "is anything cut off" answers correctly from this; a vision model asked
 * "does this look professional" must not be fooled into saying yes.
 */
import type { DeckLayout, LaidOutShape } from "./pptx-layout";

const CAPTION_BAND = 26;
/**
 * Blank space around the slide, as a fraction of its width.
 *
 * Without it, a shape hanging off the right edge is clipped by the canvas and
 * looks merely truncated. With it, the shape is drawn *outside* the slide
 * rectangle, which is the actual defect and reads instantly.
 */
const MARGIN_RATIO = 0.08;

export interface SchematicPage {
  page: number;
  width: number;
  height: number;
  png: Uint8Array;
}

/** Slide-space EMU → pixels. */
function scaler(layout: DeckLayout, maxWidth: number) {
  const scale = maxWidth / layout.width;
  return (v: number) => v * scale;
}

/**
 * Wrap `text` to `width` px, measuring with the canvas rather than guessing
 * at character counts — the whole point is to show when text does not fit.
 */
function wrap(ctx: { measureText(t: string): { width: number } }, text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let line = words[0];
  for (const word of words.slice(1)) {
    const candidate = `${line} ${word}`;
    if (ctx.measureText(candidate).width <= width) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines;
}

/** True when the shape's frame leaves the slide on any side. */
function offSlide(shape: LaidOutShape, layout: DeckLayout): boolean {
  if (shape.w === 0 && shape.h === 0) return false; // frame unknown, reported separately
  return (
    shape.x < 0 ||
    shape.y < 0 ||
    shape.x + shape.w > layout.width + 1 ||
    shape.y + shape.h > layout.height + 1
  );
}

export async function drawSlide(
  layout: DeckLayout,
  index: number,
  opts: { maxWidth: number },
): Promise<SchematicPage> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const slide = layout.slides[index - 1];
  if (!slide) throw new Error(`the deck has ${layout.slides.length} slide(s), so there is no slide ${index}`);

  // The slide itself gets the inner area; the margin exists so anything
  // outside the slide is drawn rather than clipped away.
  const margin = Math.round(opts.maxWidth * MARGIN_RATIO);
  const slideW = opts.maxWidth - margin * 2;
  const px = scaler(layout, slideW);
  const width = Math.ceil(opts.maxWidth);
  const slideH = px(layout.height);
  const height = Math.ceil(slideH) + margin * 2 + CAPTION_BAND;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Grey surround, white slide — the boundary is the thing being judged
  // against, so it has to be unmistakable.
  ctx.fillStyle = "#e8eaed";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(margin, margin, slideW, slideH);
  ctx.strokeStyle = "#9aa0a6";
  ctx.lineWidth = 1;
  ctx.strokeRect(margin + 0.5, margin + 0.5, slideW - 1, slideH - 1);

  // Everything after this is positioned in slide space.
  ctx.save();
  ctx.translate(margin, margin);

  // An empty slide is left genuinely empty. Writing "(this slide is empty)"
  // onto the canvas seems helpful and is not: a vision model asked "does this
  // slide have any content" reads the notice as content and answers yes.
  // Measured. The fact goes in the caption instead, where meta belongs.

  for (const shape of slide.shapes) {
    const x = px(shape.x);
    const y = px(shape.y);
    const w = px(shape.w);
    const h = px(shape.h);
    const escaped = offSlide(shape, layout);

    if (w > 0 && h > 0) {
      ctx.strokeStyle = escaped ? "#b00020" : shape.picture ? "#4a7fb5" : "#9aa0a6";
      ctx.setLineDash(shape.picture ? [6, 4] : []);
      ctx.lineWidth = escaped ? 2 : 1;
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
    }

    if (shape.picture) {
      ctx.fillStyle = "#4a7fb5";
      ctx.font = "14px sans-serif";
      ctx.fillText("[image]", x + 6, y + 20);
      continue;
    }

    if (shape.text.length === 0) continue;

    // Scale the declared point size the same way the geometry is scaled, so
    // "the text is too big for its box" survives into the picture.
    const pt = shape.fontSize ?? 18;
    const fontPx = Math.max(7, px((pt / 72) * 914_400));
    ctx.fillStyle = "#111111";
    ctx.font = `${shape.bold ? "bold " : ""}${fontPx.toFixed(1)}px sans-serif`;

    const pad = 4;
    const boxWidth = w > 0 ? w - pad * 2 : width - x - pad * 2;
    let cursor = y + pad + fontPx;
    let overflowed = false;
    for (const paragraph of shape.text) {
      for (const line of wrap(ctx, paragraph, boxWidth)) {
        // Past the bottom of its own box is exactly the defect being looked
        // for, so it is drawn anyway — and marked.
        if (h > 0 && cursor > y + h) overflowed = true;
        ctx.fillStyle = overflowed ? "#b00020" : "#111111";
        ctx.fillText(line, x + pad, cursor);
        cursor += fontPx * 1.25;
      }
    }
    if (overflowed) {
      ctx.strokeStyle = "#b00020";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
    }
  }

  ctx.restore();

  // Say what this is, in the image, so nothing downstream can mistake a
  // schematic for a render.
  const bandTop = height - CAPTION_BAND;
  ctx.fillStyle = "#f1f3f4";
  ctx.fillRect(0, bandTop, width, CAPTION_BAND);
  ctx.fillStyle = "#5f6368";
  ctx.font = "13px sans-serif";
  // "Thin rectangles are shape frames" earns its length: without it a model
  // reads a frame as a clipping border and reports text cut off that is not.
  const empty = slide.shapes.length === 0 ? " THIS SLIDE HAS NO SHAPES ON IT." : "";
  ctx.fillText(
    `Layout schematic — slide ${index} of ${layout.slides.length}.${empty} White area is the slide; anything drawn outside it is off-slide. ` +
      `Thin rectangles are shape frames, not visible borders. Real positions and text; not real fonts, colours or charts.`,
    8,
    bandTop + 18,
  );

  return { page: index, width, height, png: canvas.toBuffer("image/png") };
}
