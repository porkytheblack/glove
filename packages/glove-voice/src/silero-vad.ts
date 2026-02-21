import EventEmitter from "eventemitter3";
import type { VADAdapter, VADAdapterEvents } from "./adapters/types";
import {
  FrameProcessor,
  Message,
  type FrameProcessorOptions,
} from "@ricky0123/vad-web";
import type { FrameProcessorEvent } from "@ricky0123/vad-web/dist/frame-processor";
import { SileroV5 } from "@ricky0123/vad-web/dist/models/v5";
import type { Model } from "@ricky0123/vad-web/dist/models/common";
import * as ort from "onnxruntime-web/wasm";

// ─── Types ─────────────────────────────────────────────────────────────────

/**
 * WASM loading strategy for onnxruntime-web.
 *
 * - **cdn**: Load WASM files from jsDelivr CDN (default, zero-config)
 * - **local**: Load WASM files from a custom local path (for Tauri, bundled apps, etc.)
 */
export type WasmStrategy =
  | { type: "cdn" }
  | { type: "local"; path: string };

/**
 * Configuration for SileroVADAdapter.
 *
 * Extends FrameProcessorOptions from @ricky0123/vad-web with:
 * - `wasm`: Strategy for loading onnxruntime-web WASM files
 * - `modelURL`: Optional URL to the Silero VAD ONNX model (defaults to CDN)
 */
export interface SileroVADOptions extends Partial<FrameProcessorOptions> {
  /**
   * WASM loading strategy. Defaults to CDN if not specified.
   *
   * @example
   * // Use CDN (default)
   * wasm: { type: "cdn" }
   *
   * @example
   * // Self-hosted WASM files
   * wasm: { type: "local", path: "/assets/wasm" }
   */
  wasm?: WasmStrategy;

  /**
   * URL to the Silero VAD ONNX model file.
   * Defaults to v5 model from CDN.
   */
  modelURL?: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const DEFAULT_MODEL_URL =
  "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.30/dist/silero_vad_v5.onnx";

const CDN_WASM_PATH =
  "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.2/dist/";

/** V5 uses 512-sample frames at 16 kHz = 32 ms per frame */
const V5_FRAME_SAMPLES = 512;
const V5_MS_PER_FRAME = V5_FRAME_SAMPLES / 16; // 32ms

const DEFAULT_FRAME_PROCESSOR_OPTIONS: FrameProcessorOptions = {
  positiveSpeechThreshold: 0.3,
  negativeSpeechThreshold: 0.25,
  redemptionMs: 1400,
  preSpeechPadMs: 800,
  minSpeechMs: 100,
  submitUserSpeechOnPause: false,
};

// ─── SileroVADAdapter ──────────────────────────────────────────────────────

/**
 * Silero VAD adapter using @ricky0123/vad-web for accurate neural-network-based
 * voice activity detection.
 *
 * More accurate than energy-based VAD, especially in noisy environments.
 * Runs ONNX inference (~50ms per frame) using onnxruntime-web WASM backend.
 *
 * @example
 * ```ts
 * const vad = new SileroVADAdapter({
 *   positiveSpeechThreshold: 0.8,
 *   wasm: { type: "cdn" }, // or { type: "local", path: "/wasm" }
 * });
 *
 * await vad.init();
 *
 * vad.on("speech_start", () => console.log("User started speaking"));
 * vad.on("speech_end", () => console.log("User stopped speaking"));
 *
 * // Process audio frames from AudioCapture
 * audioCapture.on("chunk", (pcm: Int16Array) => {
 *   vad.process(pcm);
 * });
 * ```
 */
export class SileroVADAdapter
  extends EventEmitter<VADAdapterEvents>
  implements VADAdapter
{
  private processor: FrameProcessor | null = null;
  private model: Model | null = null;
  private speaking = false;
  private frameBuffer: Float32Array | null = null;
  private frameOffset = 0;
  private readonly options: FrameProcessorOptions & {
    wasm: WasmStrategy;
    modelURL: string;
  };

  constructor(config: SileroVADOptions = {}) {
    super();

    // Merge with defaults
    this.options = {
      ...DEFAULT_FRAME_PROCESSOR_OPTIONS,
      ...config,
      wasm: config.wasm ?? { type: "cdn" },
      modelURL: config.modelURL ?? DEFAULT_MODEL_URL,
    };
  }

  /**
   * Initialize the Silero VAD model and FrameProcessor.
   * Must be called before process().
   */
  async init(): Promise<void> {
    // Configure onnxruntime-web WASM paths
    this.configureWasm();

    // Create model fetcher
    const modelFetcher = async (): Promise<ArrayBuffer> => {
      const response = await fetch(this.options.modelURL);
      if (!response.ok) {
        throw new Error(`Failed to fetch model from ${this.options.modelURL}`);
      }
      return response.arrayBuffer();
    };

    // Load the Silero V5 model
    this.model = await SileroV5.new(ort, modelFetcher);

    // Create FrameProcessor with model's process and reset methods
    this.processor = new FrameProcessor(
      this.model.process.bind(this.model),
      this.model.reset_state.bind(this.model),
      {
        positiveSpeechThreshold: this.options.positiveSpeechThreshold,
        negativeSpeechThreshold: this.options.negativeSpeechThreshold,
        redemptionMs: this.options.redemptionMs,
        preSpeechPadMs: this.options.preSpeechPadMs,
        minSpeechMs: this.options.minSpeechMs,
        submitUserSpeechOnPause: this.options.submitUserSpeechOnPause,
      },
      V5_MS_PER_FRAME,
    );

    this.processor.resume();
  }

  private configureWasm(): void {
    const { wasm } = this.options;

    if (wasm.type === "cdn") {
      ort.env.wasm.wasmPaths = CDN_WASM_PATH;
    } else if (wasm.type === "local") {
      ort.env.wasm.wasmPaths = wasm.path.endsWith("/")
        ? wasm.path
        : `${wasm.path}/`;
    }
  }

  private frameCount = 0;

  /** Handle FrameProcessor events — maps to our adapter events. */
  private handleEvent = (event: FrameProcessorEvent): void => {
    if (event.msg === Message.FrameProcessed) {
      // Log every ~1s (every 31 frames at 32ms/frame) to diagnose model output
      if (++this.frameCount % 31 === 0) {
        console.debug(`[SileroVAD] prob=${event.probs.isSpeech.toFixed(3)} speaking=${this.speaking}`);
      }
      return;
    }
    if (event.msg === Message.SpeechStart && !this.speaking) {
      console.debug(`[SileroVAD] speech_start`);
      this.speaking = true;
      this.emit("speech_start");
    } else if (event.msg === Message.SpeechEnd && this.speaking) {
      console.debug(`[SileroVAD] speech_end`);
      this.speaking = false;
      this.emit("speech_end");
    } else if (event.msg === Message.VADMisfire) {
      // Misfire = FrameProcessor detected speech then decided it was too short.
      // It already reset its own `speaking` flag, so we must sync ours.
      // Still emit speech_end — the STT has the audio and can transcribe it.
      console.debug(`[SileroVAD] misfire → treating as speech_end`);
      if (this.speaking) {
        this.speaking = false;
        this.emit("speech_end");
      }
    }
  };

  /**
   * Process a PCM chunk. Call this on every AudioCapture "chunk" event.
   *
   * AudioWorklets emit small chunks (128 samples). The Silero V5 model
   * expects exactly 512 samples per inference call, so we accumulate
   * samples in an internal buffer and process complete frames.
   */
  process(pcm: Int16Array): void {
    if (!this.processor) {
      throw new Error("SileroVAD not initialized. Call init() first.");
    }

    // Lazy-init the frame buffer
    if (!this.frameBuffer) {
      this.frameBuffer = new Float32Array(V5_FRAME_SAMPLES);
      this.frameOffset = 0;
    }

    // Convert Int16 → Float32 (-1.0 to 1.0 range)
    let srcOffset = 0;
    while (srcOffset < pcm.length) {
      const remaining = V5_FRAME_SAMPLES - this.frameOffset;
      const available = pcm.length - srcOffset;
      const toCopy = Math.min(remaining, available);

      for (let i = 0; i < toCopy; i++) {
        const s = pcm[srcOffset + i];
        this.frameBuffer[this.frameOffset + i] = s / (s < 0 ? 32768 : 32767);
      }

      this.frameOffset += toCopy;
      srcOffset += toCopy;

      // Full frame — send to the model
      if (this.frameOffset === V5_FRAME_SAMPLES) {
        const frame = this.frameBuffer.slice();
        this.frameOffset = 0;

        this.processor.process(frame, this.handleEvent).catch((err) => {
          console.error(`[SileroVAD] ONNX inference error:`, err);
        });
      }
    }
  }

  /**
   * Force reset — call when interrupting a turn.
   */
  reset(): void {
    this.processor?.pause(this.handleEvent);
    this.processor?.reset();
    this.processor?.resume();
    this.frameOffset = 0;

    if (this.speaking) {
      this.speaking = false;
      // Don't emit speech_end on manual reset — it's a forced stop
    }
  }

  /**
   * True if speech is currently detected.
   */
  get isSpeaking(): boolean {
    return this.speaking;
  }

  /**
   * Clean up resources. Call when done using the VAD.
   */
  async destroy(): Promise<void> {
    await this.model?.release();
    this.processor = null;
    this.model = null;
  }
}
