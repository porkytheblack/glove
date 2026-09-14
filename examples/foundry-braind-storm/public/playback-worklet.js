const CAPACITY = 16_000 * 30;

class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new Float32Array(CAPACITY);
    this.read = 0;
    this.write = 0;
    this.port.onmessage = (event) => {
      if (event.data === "clear") { this.read = this.write = 0; return; }
      const pcm = new Int16Array(event.data);
      for (let index = 0; index < pcm.length; index++) {
        this.ring[this.write % CAPACITY] = pcm[index] / 0x8000;
        this.write++;
      }
    };
  }

  process(_inputs, outputs) {
    const channel = outputs[0]?.[0];
    if (!channel) return true;
    const count = Math.min(channel.length, this.write - this.read);
    for (let index = 0; index < count; index++) { channel[index] = this.ring[this.read % CAPACITY]; this.read++; }
    for (let index = count; index < channel.length; index++) channel[index] = 0;
    return true;
  }
}

registerProcessor("playback", PlaybackProcessor);
