// Continuous 20ms mono PCM at the AudioContext's 24kHz rate. The microphone
// is gated by push-to-talk, but silence keeps the GPT-Live stream clocked.
class Capture extends AudioWorkletProcessor {
  constructor() {
    super(); this.enabled = false; this.chunk = new Int16Array(480); this.offset = 0;
    this.port.onmessage = ({ data }) => { this.enabled = data === true; };
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    for (let i = 0; i < 128; i++) {
      const x = this.enabled ? Math.max(-1, Math.min(1, input?.[i] ?? 0)) : 0;
      this.chunk[this.offset++] = Math.round(x * (x < 0 ? 32768 : 32767));
      if (this.offset === 480) {
        this.port.postMessage(this.chunk.buffer, [this.chunk.buffer]);
        this.chunk = new Int16Array(480); this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor("capture", Capture);
