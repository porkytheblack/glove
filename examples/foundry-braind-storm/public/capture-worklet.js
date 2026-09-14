const FRAME_SAMPLES = 320;

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Int16Array(FRAME_SAMPLES);
    this.length = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (let index = 0; index < channel.length; index++) {
      const sample = Math.max(-1, Math.min(1, channel[index]));
      this.buffer[this.length++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      if (this.length === FRAME_SAMPLES) {
        const frame = this.buffer;
        this.port.postMessage(frame.buffer, [frame.buffer]);
        this.buffer = new Int16Array(FRAME_SAMPLES);
        this.length = 0;
      }
    }
    return true;
  }
}

registerProcessor("capture", CaptureProcessor);
