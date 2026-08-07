// Core types and contracts for glove-image. No runtime dependency on
// glove-core — only types cross that boundary.

// ─── Reference images ──────────────────────────────────────────────────────

/** What a reference image is FOR. Adapters declare which roles they honor. */
export type RefRole = "identity" | "style" | "composition" | "content" | "mask";

export interface RefImage {
  /** ImageAsset id. */
  asset: string;
  role: RefRole;
  /** 0..1, adapter-interpreted. */
  weight?: number;
}

// ─── Generation params ─────────────────────────────────────────────────────

export interface GenerationParams {
  /** "WxH", e.g. "1024x1024". Snapped to a supported size by fitToModel(). */
  size?: string;
  seed?: number;
  /** Number of candidates to generate. Clamped by fitToModel(). */
  candidates?: number;
  /** Provider passthrough. */
  extra?: Record<string, unknown>;
}

// ─── Assets & lineage ──────────────────────────────────────────────────────

export interface TraceEntry {
  /** Which inbetween ran. */
  enhancer: string;
  /** What it did / why it degraded something. */
  note?: string;
  /** Snapshot of the working prompt after this stage. */
  positive_after: string;
}

export interface Recipe {
  kind: "generated" | "edited" | "assembled";
  /** The raw ask, untouched. */
  intent?: string;
  /** What actually went to the model. */
  finalPrompt?: string;
  negative?: string;
  params?: GenerationParams;
  /** ImageModelAdapter.name. */
  adapter?: string;
  /** Library names as requested at the time. */
  characters?: string[];
  scene?: string;
  refs?: Array<{ asset: string; role: RefRole }>;
  trace?: TraceEntry[];
  /** For kind "edited": the source asset id; the edit instruction is finalPrompt. */
  parent?: string;
  /** For kind "assembled". */
  spec?: AssemblySpec;
}

export interface ImageAsset {
  id: string;
  name?: string;
  mime: string;
  width: number;
  height: number;
  source: "imported" | "generated" | "edited" | "assembled";
  recipe?: Recipe;
  created_at: string;
  tags?: string[];
}

export interface AssetFilter {
  source?: ImageAsset["source"];
  tags?: string[];
  name_contains?: string;
}

export interface ImageAssetStore {
  identifier: string;
  put(
    bytes: Uint8Array,
    meta: Omit<ImageAsset, "id" | "created_at">,
  ): Promise<ImageAsset>;
  get(id: string): Promise<ImageAsset | null>;
  bytes(id: string): Promise<Uint8Array>;
  list(filter?: AssetFilter): Promise<ImageAsset[]>;
  remove(id: string): Promise<void>;
  /** Optional: downscaled bytes for display renderData. Falls back to full bytes. */
  thumbnail?(id: string, maxEdge: number): Promise<Uint8Array>;
}

// ─── Assembly ──────────────────────────────────────────────────────────────

export interface AssemblyLayer {
  asset: string;
  x: number;
  y: number;
  /** Omit for natural size. */
  width?: number;
  height?: number;
  fit?: "cover" | "contain" | "fill";
  rotate?: number;
  /** 0..1. Applied as a flat alpha on the layer. */
  opacity?: number;
}

export interface AssemblySpec {
  canvas: { width: number; height: number; background?: string };
  /** Painted in order. */
  layers: AssemblyLayer[];
}

// ─── Library: characters & scenes ──────────────────────────────────────────

export interface CharacterDef {
  /** Library key, kebab-case ("mira"). */
  name: string;
  display_name?: string;
  /**
   * One-paragraph canonical appearance. Spliced VERBATIM into prompts —
   * write it prompt-ready.
   */
  appearance: string;
  /** Non-visual notes for the agent. Never sent to the image model. */
  notes?: string;
  negative?: string;
  /** Identity anchors, best-first. */
  ref_images?: Array<{ asset: string; label?: string }>;
  tags?: string[];
  created_at: string;
  updated_at: string;
}

export interface SceneDef {
  name: string;
  display_name?: string;
  /**
   * Canonical setting block: location, era, palette, lighting, mood.
   * Prompt-ready, spliced verbatim.
   */
  setting: string;
  negative?: string;
  ref_images?: Array<{ asset: string; role: "style" | "composition"; label?: string }>;
  tags?: string[];
  created_at: string;
  updated_at: string;
}

export interface LibraryFilter {
  tags?: string[];
  name_contains?: string;
}

export interface ImageLibraryReader {
  getCharacter(name: string): Promise<CharacterDef | null>;
  listCharacters(filter?: LibraryFilter): Promise<CharacterDef[]>;
  getScene(name: string): Promise<SceneDef | null>;
  listScenes(filter?: LibraryFilter): Promise<SceneDef[]>;
}

export interface ImageLibraryAdapter extends ImageLibraryReader {
  identifier: string;
  /** Upsert by name. */
  saveCharacter(def: CharacterDef): Promise<void>;
  removeCharacter(name: string): Promise<void>;
  saveScene(def: SceneDef): Promise<void>;
  removeScene(name: string): Promise<void>;
}

// ─── Image model adapter ───────────────────────────────────────────────────

export interface ImageModelCapabilities {
  modes: Array<"generate" | "edit" | "variation">;
  /** 0 = text-only. */
  maxRefs: number;
  refRoles: RefRole[];
  sizes: string[] | "flexible";
  negativePrompt: boolean;
  seed: boolean;
  maxCandidates: number;
}

export interface ResolvedRef extends RefImage {
  bytes: Uint8Array;
  mime: string;
}

export interface ImageGenerateRequest {
  prompt: string;
  negative?: string;
  /** Resolved by the mount — adapters never touch the store. */
  refs: ResolvedRef[];
  size?: string;
  seed?: number;
  candidates?: number;
  extra?: Record<string, unknown>;
}

export interface ImageEditRequest extends Omit<ImageGenerateRequest, "refs"> {
  base: { bytes: Uint8Array; mime: string };
  mask?: { bytes: Uint8Array; mime: string };
  refs: ResolvedRef[];
}

export interface ImageModelResult {
  images: Array<{ bytes: Uint8Array; mime: string; seed?: number }>;
  /** Provider-reported final prompt when it rewrites. Recorded in the recipe. */
  revised_prompt?: string;
}

export interface ImageModelAdapter {
  name: string;
  capabilities: ImageModelCapabilities;
  generate(
    req: ImageGenerateRequest,
    signal?: AbortSignal,
  ): Promise<ImageModelResult>;
  edit?(req: ImageEditRequest, signal?: AbortSignal): Promise<ImageModelResult>;
}

// ─── Errors ────────────────────────────────────────────────────────────────

export class ImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageError";
  }
}

export class ImageAssetNotFoundError extends ImageError {
  constructor(id: string) {
    super(`Image asset "${id}" not found`);
    this.name = "ImageAssetNotFoundError";
  }
}

export class ImageCharacterNotFoundError extends ImageError {
  constructor(name: string, available: string[]) {
    super(
      `Character "${name}" is not in the library. ` +
        (available.length
          ? `Available: ${available.join(", ")}`
          : "The library has no characters yet — save one with glove_image_character_save."),
    );
    this.name = "ImageCharacterNotFoundError";
  }
}

export class ImageSceneNotFoundError extends ImageError {
  constructor(name: string, available: string[]) {
    super(
      `Scene "${name}" is not in the library. ` +
        (available.length
          ? `Available: ${available.join(", ")}`
          : "The library has no scenes yet — save one with glove_image_scene_save."),
    );
    this.name = "ImageSceneNotFoundError";
  }
}

export class ImageCapabilityError extends ImageError {
  constructor(message: string) {
    super(message);
    this.name = "ImageCapabilityError";
  }
}

// ─── Small helpers ─────────────────────────────────────────────────────────

export function generateAssetId(): string {
  const rand =
    globalThis.crypto?.randomUUID?.().replace(/-/g, "").slice(0, 12) ??
    Math.random().toString(36).slice(2, 14);
  return `img_${rand}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Sniff mime + dimensions from image bytes without decoding pixels.
 * Supports PNG, JPEG, GIF, and WebP (VP8/VP8L/VP8X). Returns null when the
 * format isn't recognized.
 */
export function sniffImage(
  bytes: Uint8Array,
): { mime: string; width: number; height: number } | null {
  if (bytes.length < 12) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // PNG: 8-byte signature, then IHDR with width/height as BE u32.
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes.length >= 24
  ) {
    return {
      mime: "image/png",
      width: view.getUint32(16),
      height: view.getUint32(20),
    };
  }

  // JPEG: scan segments for a SOF marker.
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let off = 2;
    while (off + 9 < bytes.length) {
      if (bytes[off] !== 0xff) {
        off++;
        continue;
      }
      const marker = bytes[off + 1]!;
      // SOF0-3, 5-7, 9-11, 13-15 carry dimensions.
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return {
          mime: "image/jpeg",
          height: view.getUint16(off + 5),
          width: view.getUint16(off + 7),
        };
      }
      const len = view.getUint16(off + 2);
      off += 2 + len;
    }
    return { mime: "image/jpeg", width: 0, height: 0 };
  }

  // GIF: "GIF8", then LE u16 width/height.
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return {
      mime: "image/gif",
      width: view.getUint16(6, true),
      height: view.getUint16(8, true),
    };
  }

  // WebP: RIFF....WEBP
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50 &&
    bytes.length >= 30
  ) {
    const fourcc = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
    if (fourcc === "VP8X") {
      const w = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
      const h = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
      return { mime: "image/webp", width: w, height: h };
    }
    if (fourcc === "VP8L") {
      const b = view.getUint32(21, true);
      return {
        mime: "image/webp",
        width: (b & 0x3fff) + 1,
        height: ((b >> 14) & 0x3fff) + 1,
      };
    }
    if (fourcc === "VP8 ") {
      return {
        mime: "image/webp",
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };
    }
    return { mime: "image/webp", width: 0, height: 0 };
  }

  return null;
}

/** Encode bytes as a data: URL. */
export function toDataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

/** Decode a data: URL to bytes + mime. Throws on non-data URLs. */
export function fromDataUrl(url: string): { bytes: Uint8Array; mime: string } {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (!match) throw new ImageError("Not a base64 data: URL");
  return {
    mime: match[1]!,
    bytes: new Uint8Array(Buffer.from(match[2]!, "base64")),
  };
}
