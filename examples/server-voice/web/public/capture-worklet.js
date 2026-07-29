// Microphone → PCM16, batched into ~20ms frames.
//
// This is the entire client-side audio input stack. There is no VAD here, no
// energy threshold, no endpointing — the worklet does not decide anything, it
// just converts and forwards. Every judgment about when speech starts and stops
// happens on the server.
//
// The AudioContext is created at 16 kHz, so no resampling is needed: the
// samples arriving here are already at the rate the server and both ElevenLabs
// sockets expect.

const FRAME_SAMPLES = 320; // 20ms at 16kHz

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Int16Array(FRAME_SAMPLES);
    this.n = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      const s = Math.max(-1, Math.min(1, channel[i]));
      this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.n === FRAME_SAMPLES) {
        const frame = this.buf;
        this.port.postMessage(frame, [frame.buffer]);
        this.buf = new Int16Array(FRAME_SAMPLES);
        this.n = 0;
      }
    }
    return true;
  }
}

registerProcessor("capture", CaptureProcessor);
