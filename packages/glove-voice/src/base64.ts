// ─── Portable base64 ─────────────────────────────────────────────────────────
//
// Pure-JS base64 encode/decode with no reliance on `btoa` / `atob` (absent in
// React Native's Hermes) or `Buffer` (absent in browsers). Used by the STT/TTS
// adapters so they run unchanged in browsers, React Native, and Node.

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const LOOKUP = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

/** Encode raw bytes as a base64 string. */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;

    out += ALPHABET[b0 >> 2];
    out += ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < len ? ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < len ? ALPHABET[b2 & 0x3f] : "=";
  }
  return out;
}

/** Decode a base64 string to raw bytes. Ignores whitespace and padding. */
export function base64ToBytes(b64: string): Uint8Array {
  // Strip whitespace + padding
  let clean = "";
  for (let i = 0; i < b64.length; i++) {
    const c = b64[i];
    if (c === "=" || c === "\n" || c === "\r" || c === " " || c === "\t") continue;
    clean += c;
  }

  const outLen = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(outLen);

  let outIdx = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    const value = code < 128 ? LOOKUP[code] : -1;
    if (value === -1) continue; // skip invalid chars defensively

    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[outIdx++] = (buffer >> bits) & 0xff;
    }
  }

  return outIdx === outLen ? out : out.subarray(0, outIdx);
}
