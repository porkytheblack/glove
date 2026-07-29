// PCM16 from the room → speakers, through a ring buffer.
//
// Two things make this more than a naive queue:
//
//   • `clear` empties the buffer instantly. Barge-in is only convincing if the
//     agent stops mid-word, and by the time a person starts talking over it the
//     browser may hold seconds of already-generated audio. Dropping the socket
//     would not help — this is what actually cuts the voice off.
//   • `pause` / `resume` stop and restart playback WITHOUT touching the buffer.
//     The room sends `pause` on the first speech-ish frame it hears — long
//     before it can know whether that is a person or a door slam — so the agent
//     goes silent the instant someone starts talking. A real interruption is
//     then confirmed with `clear`; a false alarm resumes mid-word as if
//     nothing happened.
//   • `drained` reports the moment the last sample is played, which the client
//     forwards to the room. The gateway sends audio faster than realtime, so
//     it cannot know when the room actually went quiet; this is how it learns
//     when to reopen the microphone path.

const CAPACITY = 16_000 * 30; // 30s of headroom at 16kHz

class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new Float32Array(CAPACITY);
    this.read = 0;
    this.write = 0;
    this.hadAudio = false;
    this.paused = false;

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (msg === "clear") {
        this.read = this.write = 0;
        this.hadAudio = false;
        this.paused = false;
        return;
      }
      if (msg === "pause") {
        this.paused = true;
        return;
      }
      if (msg === "resume") {
        this.paused = false;
        return;
      }
      const pcm = new Int16Array(msg);
      for (let i = 0; i < pcm.length; i++) {
        this.ring[this.write % CAPACITY] = pcm[i] / 0x8000;
        this.write++;
      }
      this.hadAudio = true;
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;

    if (this.paused) {
      out.fill(0);
      return true; // hold the buffer — clear or resume decides its fate
    }

    const available = this.write - this.read;
    const n = Math.min(out.length, available);
    for (let i = 0; i < n; i++) {
      out[i] = this.ring[this.read % CAPACITY];
      this.read++;
    }
    for (let i = n; i < out.length; i++) out[i] = 0;

    if (this.hadAudio && this.write === this.read) {
      this.hadAudio = false;
      this.port.postMessage("drained");
    }
    return true;
  }
}

registerProcessor("playback", PlaybackProcessor);
