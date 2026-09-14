// Core contracts for glove-video. Adapters own provider-specific job
// creation/polling; the rest of the package only deals in completed media.

export type VideoRefRole =
  | "first-frame"
  | "last-frame"
  | "identity"
  | "style"
  | "motion"
  | "source"
  | "continuity";

export interface VideoReference {
  /** Host-defined asset id. Resolved by MountVideoConfig.resolveReference. */
  asset: string;
  role: VideoRefRole;
  /** 0..1, adapter-interpreted. */
  weight?: number;
}

export interface ResolvedVideoReference extends VideoReference {
  bytes: Uint8Array;
  mime: string;
}

export interface VideoBeat {
  /** Seconds from the start of the clip. */
  at: number;
  action: string;
}

export interface VideoGenerationParams {
  duration?: number;
  aspectRatio?: string;
  resolution?: string;
  fps?: number;
  seed?: number;
  candidates?: number;
  /** Ask the provider for generated/synchronized audio when supported. */
  audio?: boolean;
  /** Provider-specific passthrough. */
  extra?: Record<string, unknown>;
}

export interface VideoTraceEntry {
  enhancer: string;
  note?: string;
  prompt_after: string;
}

export interface VideoUsage {
  requests: number;
  tokens_in: number;
  tokens_out: number;
  /** Billable generated seconds, when known. */
  seconds_generated: number;
  cost_usd?: number;
}

export type VideoUsageSource = "generate" | "extend" | "transform" | "enhance" | "review";

export function emptyVideoUsage(): VideoUsage {
  return { requests: 0, tokens_in: 0, tokens_out: 0, seconds_generated: 0 };
}

export function addVideoUsage(
  target: VideoUsage,
  value?: Partial<VideoUsage>,
): VideoUsage {
  if (!value) return target;
  target.requests += value.requests ?? 0;
  target.tokens_in += value.tokens_in ?? 0;
  target.tokens_out += value.tokens_out ?? 0;
  target.seconds_generated += value.seconds_generated ?? 0;
  if (value.cost_usd !== undefined) {
    target.cost_usd = (target.cost_usd ?? 0) + value.cost_usd;
  }
  return target;
}

export class VideoUsageMeter {
  private total = emptyVideoUsage();
  private bySource = new Map<VideoUsageSource, VideoUsage>();

  record(source: VideoUsageSource, usage: Partial<VideoUsage>): void {
    addVideoUsage(this.total, usage);
    const bucket = this.bySource.get(source) ?? emptyVideoUsage();
    addVideoUsage(bucket, usage);
    this.bySource.set(source, bucket);
  }

  report(): { total: VideoUsage; by_source: Record<string, VideoUsage> } {
    const by_source: Record<string, VideoUsage> = {};
    for (const [source, usage] of this.bySource) by_source[source] = { ...usage };
    return { total: { ...this.total }, by_source };
  }

  reset(): void {
    this.total = emptyVideoUsage();
    this.bySource.clear();
  }
}

export interface VideoRecipe {
  kind: "generated" | "extended" | "transformed" | "flow-shot";
  intent: string;
  finalPrompt: string;
  negative?: string;
  beats?: VideoBeat[];
  params?: VideoGenerationParams;
  adapter: string;
  characters?: string[];
  scene?: string;
  refs?: Array<{ asset: string; role: VideoRefRole }>;
  trace?: VideoTraceEntry[];
  /** Source clip for extensions/transforms. */
  parent?: string;
  /** Flow lineage for generated shots. */
  flow?: { run: string; shot: string };
  usage?: VideoUsage;
}

export interface VideoAsset {
  id: string;
  name?: string;
  mime: string;
  width: number;
  height: number;
  duration: number;
  fps?: number;
  has_audio?: boolean;
  source: "imported" | "generated" | "extended" | "transformed" | "flow";
  recipe?: VideoRecipe;
  created_at: string;
  tags?: string[];
}

export interface VideoAssetFilter {
  source?: VideoAsset["source"];
  tags?: string[];
  name_contains?: string;
}

export interface VideoAssetStore {
  identifier: string;
  put(
    bytes: Uint8Array,
    meta: Omit<VideoAsset, "id" | "created_at">,
  ): Promise<VideoAsset>;
  get(id: string): Promise<VideoAsset | null>;
  bytes(id: string): Promise<Uint8Array>;
  list(filter?: VideoAssetFilter): Promise<VideoAsset[]>;
  remove(id: string): Promise<void>;
  /** Optional playable URL for renderData. Prefer short-lived signed URLs. */
  url?(id: string): Promise<string>;
}

export type VideoReviewDecision = "pass" | "revise";

export interface VideoReviewIssue {
  criterion: string;
  severity: "minor" | "major" | "critical";
  /** A concrete moment or visible/audible symptom in the clip. */
  evidence: string;
  /** An actionable change for the next generation attempt. */
  fix: string;
}

/** A model's inspection of the actual video bytes against the creative brief. */
export interface VideoReview {
  id: string;
  asset: string;
  decision: VideoReviewDecision;
  score: number;
  brief: string;
  rubric?: string;
  summary: string;
  strengths: string[];
  issues: VideoReviewIssue[];
  revision_prompt?: string;
  reviewer: string;
  created_at: string;
  usage?: VideoUsage;
  /** Extra visual anchors supplied only to the reviewer, not necessarily to generation. */
  reference_assets?: string[];
}

export interface VideoReviewStore {
  identifier: string;
  save(review: VideoReview): Promise<void>;
  latest(asset: string): Promise<VideoReview | null>;
  list(asset?: string): Promise<VideoReview[]>;
}

export interface VideoCharacterDef {
  name: string;
  display_name?: string;
  /** Canonical visual identity, spliced verbatim into every prompt. */
  appearance: string;
  /** Canonical movement, mannerisms, and performance direction. */
  performance?: string;
  negative?: string;
  /** Image or video ids understood by the configured reference resolver. */
  refs?: Array<{ asset: string; role: "identity" | "motion"; label?: string }>;
  tags?: string[];
  created_at: string;
  updated_at: string;
}

export interface VideoSceneDef {
  name: string;
  display_name?: string;
  /** Canonical setting, palette, lighting, and atmosphere. */
  setting: string;
  /** Motion that should stay alive in the environment. */
  ambient_motion?: string;
  negative?: string;
  refs?: Array<{ asset: string; role: "style" | "continuity"; label?: string }>;
  tags?: string[];
  created_at: string;
  updated_at: string;
}

export interface VideoLibraryFilter {
  tags?: string[];
  name_contains?: string;
}

export interface VideoLibraryReader {
  getCharacter(name: string): Promise<VideoCharacterDef | null>;
  listCharacters(filter?: VideoLibraryFilter): Promise<VideoCharacterDef[]>;
  getScene(name: string): Promise<VideoSceneDef | null>;
  listScenes(filter?: VideoLibraryFilter): Promise<VideoSceneDef[]>;
}

export interface VideoLibraryAdapter extends VideoLibraryReader {
  identifier: string;
  saveCharacter(def: VideoCharacterDef): Promise<void>;
  removeCharacter(name: string): Promise<void>;
  saveScene(def: VideoSceneDef): Promise<void>;
  removeScene(name: string): Promise<void>;
}

export interface VideoModelCapabilities {
  modes: Array<"text-to-video" | "image-to-video" | "video-to-video" | "extend">;
  maxRefs: number;
  refRoles: VideoRefRole[];
  durations: number[] | { min: number; max: number };
  aspectRatios: string[] | "flexible";
  resolutions: string[] | "flexible";
  audio: boolean;
  negativePrompt: boolean;
  seed: boolean;
  maxCandidates: number;
}

export interface VideoGenerateRequest {
  prompt: string;
  negative?: string;
  refs: ResolvedVideoReference[];
  beats?: VideoBeat[];
  params: VideoGenerationParams;
}

export interface VideoExtendRequest extends VideoGenerateRequest {
  source: { bytes: Uint8Array; mime: string };
}

export interface VideoTransformRequest extends VideoGenerateRequest {
  source: { bytes: Uint8Array; mime: string };
}

export interface VideoModelOutput {
  bytes: Uint8Array;
  mime: string;
  width?: number;
  height?: number;
  duration?: number;
  fps?: number;
  has_audio?: boolean;
  seed?: number;
}

export interface VideoModelResult {
  videos: VideoModelOutput[];
  revised_prompt?: string;
  usage?: Partial<VideoUsage>;
  /** Provider job ids are useful for auditing but never required for resume. */
  provider_job_ids?: string[];
}

export interface VideoProgress {
  phase: "queued" | "generating" | "downloading";
  /** 0..1 when the provider exposes progress. */
  progress?: number;
  message?: string;
  provider_job_id?: string;
}

export interface VideoCallContext {
  signal?: AbortSignal;
  onProgress?: (event: VideoProgress) => void | Promise<void>;
}

export interface VideoModelAdapter {
  name: string;
  capabilities: VideoModelCapabilities;
  /** Resolve only after media bytes are available; polling belongs here. */
  generate(req: VideoGenerateRequest, ctx?: VideoCallContext): Promise<VideoModelResult>;
  extend?(req: VideoExtendRequest, ctx?: VideoCallContext): Promise<VideoModelResult>;
  transform?(req: VideoTransformRequest, ctx?: VideoCallContext): Promise<VideoModelResult>;
}

export type VideoReferenceResolver = (
  ref: VideoReference,
) => Promise<{ bytes: Uint8Array; mime: string }>;

export class VideoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoError";
  }
}

export class VideoAssetNotFoundError extends VideoError {
  constructor(id: string) {
    super(`Video asset "${id}" not found`);
    this.name = "VideoAssetNotFoundError";
  }
}

export class VideoCharacterNotFoundError extends VideoError {
  constructor(name: string, available: string[]) {
    super(
      `Character "${name}" is not in the video library. ` +
        (available.length ? `Available: ${available.join(", ")}` : "The library has no characters yet."),
    );
    this.name = "VideoCharacterNotFoundError";
  }
}

export class VideoSceneNotFoundError extends VideoError {
  constructor(name: string, available: string[]) {
    super(
      `Scene "${name}" is not in the video library. ` +
        (available.length ? `Available: ${available.join(", ")}` : "The library has no scenes yet."),
    );
    this.name = "VideoSceneNotFoundError";
  }
}

export class VideoCapabilityError extends VideoError {
  constructor(message: string) {
    super(message);
    this.name = "VideoCapabilityError";
  }
}

export function generateVideoAssetId(): string {
  const rand =
    globalThis.crypto?.randomUUID?.().replace(/-/g, "").slice(0, 12) ??
    Math.random().toString(36).slice(2, 14);
  return `vid_${rand}`;
}

export function generateVideoFlowRunId(): string {
  const rand =
    globalThis.crypto?.randomUUID?.().replace(/-/g, "").slice(0, 12) ??
    Math.random().toString(36).slice(2, 14);
  return `vflow_${rand}`;
}

export function generateVideoReviewId(): string {
  const rand =
    globalThis.crypto?.randomUUID?.().replace(/-/g, "").slice(0, 12) ??
    Math.random().toString(36).slice(2, 14);
  return `vrev_${rand}`;
}

export function videoNowIso(): string {
  return new Date().toISOString();
}

export function videoToDataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

export function videoFromDataUrl(url: string): { bytes: Uint8Array; mime: string } {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (!match) throw new VideoError("Not a base64 data: URL");
  return {
    mime: match[1]!,
    bytes: new Uint8Array(Buffer.from(match[2]!, "base64")),
  };
}

export interface VideoMediaMetadata {
  width?: number;
  height?: number;
  duration?: number;
  has_audio?: boolean;
}

interface Mp4Box {
  type: string;
  dataStart: number;
  end: number;
}

function mp4Boxes(view: DataView, start: number, end: number): Mp4Box[] {
  const boxes: Mp4Box[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset);
    const type = String.fromCharCode(
      view.getUint8(offset + 4),
      view.getUint8(offset + 5),
      view.getUint8(offset + 6),
      view.getUint8(offset + 7),
    );
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) break;
      const large = view.getBigUint64(offset + 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) break;
      size = Number(large);
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < header || offset + size > end) break;
    boxes.push({ type, dataStart: offset + header, end: offset + size });
    offset += size;
  }
  return boxes;
}

function mp4Child(view: DataView, parent: Mp4Box, type: string): Mp4Box | undefined {
  return mp4Boxes(view, parent.dataStart, parent.end).find((box) => box.type === type);
}

function mp4Handler(view: DataView, mdia: Mp4Box): string | undefined {
  const hdlr = mp4Child(view, mdia, "hdlr");
  if (!hdlr || hdlr.dataStart + 12 > hdlr.end) return undefined;
  return String.fromCharCode(
    view.getUint8(hdlr.dataStart + 8),
    view.getUint8(hdlr.dataStart + 9),
    view.getUint8(hdlr.dataStart + 10),
    view.getUint8(hdlr.dataStart + 11),
  );
}

function mp4TrackDuration(view: DataView, mdia: Mp4Box): number | undefined {
  const mdhd = mp4Child(view, mdia, "mdhd");
  if (!mdhd || mdhd.dataStart + 20 > mdhd.end) return undefined;
  const version = view.getUint8(mdhd.dataStart);
  const timescaleOffset = mdhd.dataStart + (version === 1 ? 20 : 12);
  const durationOffset = mdhd.dataStart + (version === 1 ? 24 : 16);
  if (timescaleOffset + 4 > mdhd.end) return undefined;
  const timescale = view.getUint32(timescaleOffset);
  if (timescale === 0) return undefined;
  if (version === 1) {
    if (durationOffset + 8 > mdhd.end) return undefined;
    const duration = view.getBigUint64(durationOffset);
    if (duration > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
    return Number(duration) / timescale;
  }
  if (durationOffset + 4 > mdhd.end) return undefined;
  return view.getUint32(durationOffset) / timescale;
}

/** Read the core display metadata from an ISO-BMFF/MP4 file without decoding it. */
export function inspectMp4Metadata(bytes: Uint8Array): VideoMediaMetadata {
  if (bytes.byteLength < 8) return {};
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const moov = mp4Boxes(view, 0, view.byteLength).find((box) => box.type === "moov");
  if (!moov) return {};
  let video: VideoMediaMetadata | undefined;
  let hasAudio = false;
  for (const trak of mp4Boxes(view, moov.dataStart, moov.end).filter((box) => box.type === "trak")) {
    const mdia = mp4Child(view, trak, "mdia");
    if (!mdia) continue;
    const handler = mp4Handler(view, mdia);
    if (handler === "soun") hasAudio = true;
    if (handler !== "vide" || video) continue;
    const tkhd = mp4Child(view, trak, "tkhd");
    const width = tkhd && tkhd.end >= tkhd.dataStart + 8
      ? Math.round(view.getUint32(tkhd.end - 8) / 65_536)
      : undefined;
    const height = tkhd && tkhd.end >= tkhd.dataStart + 8
      ? Math.round(view.getUint32(tkhd.end - 4) / 65_536)
      : undefined;
    const duration = mp4TrackDuration(view, mdia);
    video = {
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
      ...(duration !== undefined ? { duration } : {}),
    };
  }
  return { ...(video ?? {}), has_audio: hasAudio };
}
