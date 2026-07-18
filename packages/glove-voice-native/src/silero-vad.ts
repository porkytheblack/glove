import EventEmitter from "eventemitter3";
import { InferenceSession, Tensor } from "onnxruntime-react-native";
import type { VADAdapter, VADAdapterEvents } from "glove-voice";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SileroVADNativeOptions {
  /**
   * The Silero v5 ONNX model — either a local absolute file path (bundle it
   * yourself) or an https URL (default: jsDelivr CDN). URL models are
   * downloaded once and cached on-device via `expo-file-system`
   * (`npx expo install expo-file-system`); local paths need nothing extra.
   */
  model?: string;

  /** Probability at/above which a frame counts as speech (default: 0.5). */
  positiveSpeechThreshold?: number;

  /** Probability below which a frame counts as silence (default: 0.35). */
  negativeSpeechThreshold?: number;

  /** Silence (ms) tolerated before a speech segment ends (default: 1400). */
  redemptionMs?: number;

  /**
   * Speech shorter than this is reported as `vad_misfire` (noise burst)
   * instead of a confirmed segment (default: 250).
   */
  minSpeechMs?: number;
}

// ─── Constants ─────────────────────────────────────────────────────────────

export const SILERO_V5_MODEL_URL =
  "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.30/dist/silero_vad_v5.onnx";

/** V5 uses 512-sample frames at 16 kHz = 32 ms per frame */
const FRAME_SAMPLES = 512;
const MS_PER_FRAME = FRAME_SAMPLES / 16; // 32ms

// ─── SileroVADNativeAdapter ────────────────────────────────────────────────

/**
 * Silero VAD v5 for React Native / Expo, running on `onnxruntime-react-native`.
 *
 * Same event contract as the browser `SileroVADAdapter` — `speech_start`
 * (tentative), `speech_real_start` (confirmed — the noise-robust barge-in
 * trigger), `vad_misfire` (retracted noise burst), `speech_end`, and
 * per-frame `speech_prob` — so GloveVoice's speech gating and confirmed
 * barge-in work identically on-device.
 *
 * ```ts
 * const vad = new SileroVADNativeAdapter(); // downloads + caches the model
 * await vad.init();
 * const voice = { stt, createTTS, vad, audio: createNativeAudioIO() };
 * ```
 *
 * Requires `onnxruntime-react-native` (native module — dev client, not
 * Expo Go) and, for URL models, `expo-file-system`.
 */
export class SileroVADNativeAdapter
  extends EventEmitter<VADAdapterEvents>
  implements VADAdapter
{
  readonly supportsRealStart = true;

  private session: InferenceSession | null = null;
  private state: Tensor | null = null;
  private srTensor: Tensor | null = null;

  private frameBuffer: Float32Array | null = null;
  private frameOffset = 0;

  // Serialize inference — onAudioReady cadence can outpace a single run.
  private chain: Promise<void> = Promise.resolve();
  private disposed = false;

  // Segment state machine (mirrors @ricky0123/vad-web's FrameProcessor)
  private speaking = false;
  private redemptionCounter = 0;
  private speechFrameCount = 0;
  private realStartFired = false;

  private readonly model: string;
  private readonly positive: number;
  private readonly negative: number;
  private readonly redemptionFrames: number;
  private readonly minSpeechFrames: number;

  constructor(options: SileroVADNativeOptions = {}) {
    super();
    this.model = options.model ?? SILERO_V5_MODEL_URL;
    this.positive = options.positiveSpeechThreshold ?? 0.5;
    this.negative = options.negativeSpeechThreshold ?? 0.35;
    this.redemptionFrames = Math.max(
      1,
      Math.round((options.redemptionMs ?? 1400) / MS_PER_FRAME),
    );
    this.minSpeechFrames = Math.max(
      1,
      Math.round((options.minSpeechMs ?? 250) / MS_PER_FRAME),
    );
  }

  /** Load the model (downloading + caching it first when given a URL). */
  async init(): Promise<void> {
    const path = await resolveModelPath(this.model);
    this.session = await InferenceSession.create(path);
    // Silero v5 inputs: input [1, 512] float32, state [2, 1, 128] float32, sr int64
    this.srTensor = new Tensor("int64", BigInt64Array.from([16_000n]), [1]);
    this.state = freshState();
  }

  /**
   * Process a PCM chunk. Chunks of any size are accumulated into the
   * 512-sample frames the model expects.
   */
  process(pcm: Int16Array): void {
    if (!this.session) {
      throw new Error("SileroVADNativeAdapter not initialized. Call init() first.");
    }

    if (!this.frameBuffer) {
      this.frameBuffer = new Float32Array(FRAME_SAMPLES);
      this.frameOffset = 0;
    }

    let srcOffset = 0;
    while (srcOffset < pcm.length) {
      const remaining = FRAME_SAMPLES - this.frameOffset;
      const available = pcm.length - srcOffset;
      const toCopy = Math.min(remaining, available);

      for (let i = 0; i < toCopy; i++) {
        const s = pcm[srcOffset + i];
        this.frameBuffer[this.frameOffset + i] = s / (s < 0 ? 32768 : 32767);
      }

      this.frameOffset += toCopy;
      srcOffset += toCopy;

      if (this.frameOffset === FRAME_SAMPLES) {
        const frame = this.frameBuffer.slice();
        this.frameOffset = 0;
        this.chain = this.chain
          .then(() => this.runFrame(frame))
          .catch((err) => {
            console.error("[SileroVADNative] inference error:", err);
          });
      }
    }
  }

  private async runFrame(frame: Float32Array): Promise<void> {
    if (this.disposed || !this.session || !this.state || !this.srTensor) return;

    const input = new Tensor("float32", frame, [1, FRAME_SAMPLES]);
    const out = await this.session.run({
      input,
      state: this.state,
      sr: this.srTensor,
    });

    const nextState = out["stateN"];
    if (nextState) this.state = nextState as Tensor;

    const output = out["output"];
    if (!output) return;
    const prob = Number((output as Tensor).data[0]);
    this.handleProb(prob);
  }

  /** Threshold state machine — mirrors vad-web's FrameProcessor semantics. */
  private handleProb(prob: number): void {
    this.emit("speech_prob", prob);

    if (prob >= this.positive) {
      this.redemptionCounter = 0;
      this.speechFrameCount++;

      if (!this.speaking) {
        this.speaking = true;
        this.emit("speech_start");
      }
      if (this.speechFrameCount === this.minSpeechFrames && !this.realStartFired) {
        this.realStartFired = true;
        this.emit("speech_real_start");
      }
      return;
    }

    if (prob < this.negative && this.speaking) {
      this.redemptionCounter++;
      if (this.redemptionCounter >= this.redemptionFrames) {
        const confirmed = this.speechFrameCount >= this.minSpeechFrames;
        this.resetSegment();
        this.emit(confirmed ? "speech_end" : "vad_misfire");
      }
    }
    // Between thresholds: hold current state (matches FrameProcessor).
  }

  private resetSegment(): void {
    this.speaking = false;
    this.redemptionCounter = 0;
    this.speechFrameCount = 0;
    this.realStartFired = false;
  }

  /** Force reset — call when interrupting a turn. Emits no events. */
  reset(): void {
    this.resetSegment();
    this.frameOffset = 0;
    this.state = this.session ? freshState() : null;
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }

  /** Release the ONNX session. The adapter cannot be reused afterwards. */
  async destroy(): Promise<void> {
    this.disposed = true;
    await this.chain.catch(() => {});
    await this.session?.release().catch(() => {});
    this.session = null;
    this.state = null;
    this.srTensor = null;
  }
}

// ─── Model resolution ──────────────────────────────────────────────────────

function freshState(): Tensor {
  return new Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
}

interface ExpoFileSystemLegacy {
  cacheDirectory: string | null;
  getInfoAsync(uri: string): Promise<{ exists: boolean }>;
  makeDirectoryAsync(uri: string, options?: { intermediates?: boolean }): Promise<unknown>;
  downloadAsync(url: string, uri: string): Promise<unknown>;
}

async function loadExpoFileSystem(): Promise<ExpoFileSystemLegacy> {
  // SDK 54+ moved the classic API to expo-file-system/legacy; older SDKs
  // export it from the package root. Try both.
  for (const specifier of ["expo-file-system/legacy", "expo-file-system"]) {
    try {
      const spec: string = specifier;
      const mod = (await import(spec)) as
        | (Partial<ExpoFileSystemLegacy> & { default?: Partial<ExpoFileSystemLegacy> })
        | undefined;
      const candidate =
        mod && typeof mod.downloadAsync === "function" ? mod : mod?.default;
      if (
        candidate &&
        typeof candidate.downloadAsync === "function" &&
        typeof candidate.getInfoAsync === "function" &&
        candidate.cacheDirectory
      ) {
        return candidate as ExpoFileSystemLegacy;
      }
    } catch {
      // try the next specifier
    }
  }
  throw new Error(
    "Loading the Silero model from a URL requires expo-file-system " +
      "(npx expo install expo-file-system). Alternatively pass a local " +
      "file path via the `model` option.",
  );
}

/** djb2 — stable short hash so different model URLs get distinct cache files. */
function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

async function resolveModelPath(model: string): Promise<string> {
  if (!/^https?:\/\//i.test(model)) {
    return stripFileScheme(model);
  }

  const fs = await loadExpoFileSystem();
  const dir = `${fs.cacheDirectory}glove-voice-native`;
  const dest = `${dir}/silero_${hashString(model)}.onnx`;

  const info = await fs.getInfoAsync(dest);
  if (!info.exists) {
    await fs.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    await fs.downloadAsync(model, dest);
  }

  // onnxruntime-react-native expects a plain filesystem path, not a file:// URI.
  return stripFileScheme(dest);
}

function stripFileScheme(path: string): string {
  return path.startsWith("file://") ? path.slice("file://".length) : path;
}
