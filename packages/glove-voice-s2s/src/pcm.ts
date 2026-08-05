// Base64 ⇄ Int16 PCM, in pure JS.
//
// No Buffer, no btoa/atob: adapters have to run in Node, the browser, and
// React Native, and each is missing a different one of those.

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function int16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? "=" : B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? "=" : B64[b2 & 63];
  }
  return out;
}

export function base64ToInt16(b64: string): Int16Array {
  const clean = b64.replace(/=+$/, "");
  const bytes = new Uint8Array((clean.length * 3) >> 2);
  let acc = 0, bits = 0, n = 0;
  for (const ch of clean) {
    const v = B64.indexOf(ch);
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[n++] = (acc >> bits) & 0xff;
    }
  }
  // Odd trailing byte can't form a sample; drop it rather than emit noise.
  return new Int16Array(bytes.buffer, 0, n >> 1);
}
