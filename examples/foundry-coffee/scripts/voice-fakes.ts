import EventEmitter from "eventemitter3";
import type {
  AudioIO,
  PendingSpeakers,
  STTAdapterEvents,
  SpeakerListener,
  SpeakerSource,
  SpeakerTurn,
  TTSAdapterEvents,
} from "glove-voice";

// Stand-ins for the microphone, Scribe and the speaker, so `pnpm verify` can
// run the voice pipeline with no audio and no network.

/** Speech-to-text that "hears" whatever the script says, with speaker labels. */
export class ScriptedSTT extends EventEmitter<STTAdapterEvents> {
  currentPartial = "";
  isConnected = true;
  private readonly speakerListeners = new Set<SpeakerListener>();
  private pending: PendingSpeakers = { draft: null, settled: Promise.resolve(null) };
  readonly speakers: SpeakerSource = {
    enabled: true,
    forFinal: () => this.pending,
    subscribe: (listener) => {
      this.speakerListeners.add(listener);
      return () => this.speakerListeners.delete(listener);
    },
  };

  async connect(): Promise<void> {}
  sendAudio(): void {}
  flushUtterance(): void {}
  disconnect(): void {}

  /** One finished utterance and who said each part of it. */
  say(text: string, parts: Array<[speaker: string, text: string]>): void {
    let at = 0;
    const turns: SpeakerTurn[] = parts.map(([speakerId, said]) => {
      const start = at;
      at += said.split(/\s+/).length * 0.4;
      return { speakerId, text: said, start, end: at };
    });
    this.pending = { draft: turns, settled: Promise.resolve(turns) };
    this.emit("final", text);
    for (const listener of this.speakerListeners) listener.segment?.(turns);
  }
}

/** Text-to-speech that writes down what it was asked to say, chunk by chunk as a real stream gets it. */
export class RecordingTTS extends EventEmitter<TTSAdapterEvents> {
  isReady = true;
  constructor(private readonly spoken: string[]) {
    super();
  }
  async open(): Promise<void> {}
  sendText(text: string): void {
    this.spoken.push(text);
  }
  flush(): void {
    this.emit("done");
  }
  destroy(): void {}
}

/** A microphone that hears nothing and a speaker that plays nothing. */
export function silentAudio(): AudioIO {
  return {
    createCapture: () => {
      const capture = new EventEmitter() as unknown as ReturnType<AudioIO["createCapture"]>;
      Object.assign(capture, { init: async () => {}, destroy: async () => {} });
      return capture;
    },
    createPlayer: () => ({
      async init() {},
      enqueue() {},
      onDrained(done: () => void) {
        done();
      },
      stop() {},
      async destroy() {},
    }),
  };
}
