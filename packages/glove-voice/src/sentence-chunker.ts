/**
 * Splits a completed response string into sentence-sized chunks for streaming TTS.
 * Sending sentence-by-sentence means ElevenLabs can start generating audio
 * ~400ms after the first sentence, rather than waiting for the full response.
 */

const SENTENCE_BOUNDARY = /(?<=[.?!])\s+/;

export function* splitSentences(text: string): Generator<string> {
  const parts = text.split(SENTENCE_BOUNDARY);
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed) yield trimmed + " ";
  }
}

/**
 * Accumulates streaming tokens and emits complete sentences as they form.
 * Use this if Glove ever exposes a token-streaming API — then TTS starts
 * on the first ~30 tokens instead of waiting for the full response.
 *
 * Usage with a hypothetical streaming Glove:
 *   const buffer = new SentenceBuffer();
 *   for await (const token of glove.streamRequest(text)) {
 *     for (const sentence of buffer.push(token)) {
 *       tts.sendText(sentence);
 *     }
 *   }
 *   const remainder = buffer.flush();
 *   if (remainder) tts.sendText(remainder);
 */
export class SentenceBuffer {
  private buffer = "";

  /**
   * Push a token. Returns any newly completed sentences.
   */
  push(token: string): string[] {
    this.buffer += token;
    const complete: string[] = [];

    // Match complete sentences including trailing whitespace
    const re = /[^.?!]*[.?!]+\s*/g;
    let match: RegExpExecArray | null;
    let lastIndex = 0;

    while ((match = re.exec(this.buffer)) !== null) {
      complete.push(match[0]);
      lastIndex = re.lastIndex;
    }

    if (complete.length > 0) {
      this.buffer = this.buffer.slice(lastIndex);
    }

    return complete;
  }

  /** Flush whatever's left at end of stream */
  flush(): string {
    const remainder = this.buffer.trim();
    this.buffer = "";
    return remainder;
  }

  reset(): void {
    this.buffer = "";
  }
}