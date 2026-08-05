// Browser audio plumbing for TRANSPORT-mode adapters (Gemini Live).
//
// A transport adapter moves PCM and nothing else, so the host owns both ends:
// microphone capture (downsampled to the adapter's declared inputFormat) and
// speaker playback (at the rate stamped on each `audio` event). Device-mode
// adapters (OpenAI Realtime over WebRTC) need none of this.

/** Capture the mic, downsample to `targetRate`, and hand PCM chunks over. */
export async function startMicCapture(
  targetRate: number,
  onPcm: (pcm: Int16Array) => void,
): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const ratio = ctx.sampleRate / targetRate;

  proc.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    const outLen = Math.floor(input.length / ratio);
    const out = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const v = input[Math.floor(i * ratio)];
      out[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
    }
    onPcm(out);
  };

  // ScriptProcessor only fires when connected to the destination; route it
  // through a zero-gain node so the raw mic never reaches the speakers.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(proc);
  proc.connect(mute);
  mute.connect(ctx.destination);

  return () => {
    proc.disconnect();
    source.disconnect();
    mute.disconnect();
    for (const t of stream.getTracks()) t.stop();
    void ctx.close();
  };
}

export interface PcmPlayer {
  play(pcm: Int16Array, sampleRate: number): void;
  /** Drop everything queued — call on `interrupted` so barge-in cuts speech. */
  flush(): void;
  close(): Promise<void>;
}

/** Gapless playback: chunks are scheduled back-to-back on one AudioContext. */
export function createPcmPlayer(): PcmPlayer {
  const ctx = new AudioContext();
  let nextAt = 0;
  const active = new Set<AudioBufferSourceNode>();

  return {
    play(pcm, sampleRate) {
      if (pcm.length === 0) return;
      const buf = ctx.createBuffer(1, pcm.length, sampleRate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      const at = Math.max(ctx.currentTime, nextAt);
      src.start(at);
      nextAt = at + buf.duration;
      active.add(src);
      src.onended = () => active.delete(src);
    },
    flush() {
      for (const s of active) {
        try {
          s.stop();
        } catch {
          /* already stopped */
        }
      }
      active.clear();
      nextAt = 0;
    },
    async close() {
      this.flush();
      await ctx.close();
    },
  };
}
