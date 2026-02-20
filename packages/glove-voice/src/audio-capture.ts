import EventEmitter from "eventemitter3";
import { GloveVoiceError } from "./errors";

type AudioCaptureEvents = {
  chunk: [pcm: Int16Array];
  error: [Error];
};

const WORKLET_PROCESSOR_CODE = /* js */ `
class PcmProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const float32 = input[0];
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const clamped = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = clamped < 0 ? clamped * 32768 : clamped * 32767;
    }
    this.port.postMessage(int16, [int16.buffer]);
    return true;
  }
}
registerProcessor("pcm-processor", PcmProcessor);
`;

/**
 * Captures microphone input via Web Audio API and emits raw PCM chunks.
 * Uses AudioWorklet for processing.
 */
export class AudioCapture extends EventEmitter<AudioCaptureEvents> {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private blobUrl: string | null = null;
  private readonly sampleRate: number;

  constructor(sampleRate = 16_000) {
    super();
    this.sampleRate = sampleRate;
  }

  async init(): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: this.sampleRate,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      const e = err as DOMException;
      if (e.name === "NotAllowedError") {
        throw new GloveVoiceError(
          "ERR_MIC_DENIED",
          "Microphone access was denied. GloveVoice requires microphone permission to capture audio.",
          { cause: e },
        );
      }
      throw new GloveVoiceError(
        "ERR_MIC_UNAVAILABLE",
        `Microphone is unavailable: ${e.message}`,
        { cause: e },
      );
    }

    this.context = new AudioContext({ sampleRate: this.sampleRate });

    const blob = new Blob([WORKLET_PROCESSOR_CODE], { type: "application/javascript" });
    this.blobUrl = URL.createObjectURL(blob);
    await this.context.audioWorklet.addModule(this.blobUrl);

    this.source = this.context.createMediaStreamSource(this.stream);
    this.workletNode = new AudioWorkletNode(this.context, "pcm-processor");

    this.workletNode.port.onmessage = (e: MessageEvent<Int16Array>) => {
      this.emit("chunk", e.data);
    };

    this.source.connect(this.workletNode);
    this.workletNode.connect(this.context.destination);
  }

  async destroy(): Promise<void> {
    this.workletNode?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.context?.close();
    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
    this.workletNode = null;
    this.source = null;
    this.stream = null;
    this.context = null;
    this.blobUrl = null;
  }
}
