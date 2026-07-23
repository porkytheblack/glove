// Incremental parser for the <speech>…</speech> protocol.
//
// The front agent's raw output is NOT spoken. Only text inside <speech> tags
// reaches the client / TTS. Because the model streams, a tag can arrive split
// across chunks ("<spe" + "ech>hello"), so the parser holds back any suffix
// that could still turn out to be a tag and emits everything else as soon as
// it is unambiguous — spoken audio starts on the first in-tag token.

const OPEN = "<speech>";
const CLOSE = "</speech>";

/** Length of the longest suffix of `buf` that is a proper prefix of `tag`. */
function partialTagSuffix(buf: string, tag: string): number {
  const max = Math.min(buf.length, tag.length - 1);
  for (let n = max; n > 0; n--) {
    if (buf.endsWith(tag.slice(0, n))) return n;
  }
  return 0;
}

/** Per-turn protocol stats — how well the model followed the <speech> contract. */
export interface SpeechParseStats {
  /** Characters emitted as speech (incl. inter-block separators). */
  spokenChars: number;
  /** Characters outside the tags — silent notes / chatter, never surfaced. */
  discardedChars: number;
  /** Number of <speech> blocks opened this turn. */
  blocks: number;
  /** True if the turn ended inside an unclosed <speech> tag (tolerated, but a protocol violation). */
  unclosed: boolean;
}

export class SpeechTagParser {
  private buf = "";
  private inside = false;
  private spoken = "";
  private rawText = "";
  private _stats: SpeechParseStats = { spokenChars: 0, discardedChars: 0, blocks: 0, unclosed: false };

  constructor(private readonly onSpeech: (text: string) => void) {}

  /** Valid after finish(). */
  get stats(): SpeechParseStats {
    return { ...this._stats };
  }

  /** The turn's FULL raw output (tags, silent notes and all) — for transcripts/evals. */
  get raw(): string {
    return this.rawText;
  }

  /** Feed one streamed chunk. Emits any newly-unambiguous in-tag text. */
  push(chunk: string): void {
    if (!chunk) return;
    this.rawText += chunk;
    this.buf += chunk;
    this.drain();
  }

  /**
   * End of turn. An unclosed <speech> is tolerated (its remainder is spoken —
   * better to finish the sentence than swallow it). Returns everything spoken
   * this turn.
   */
  finish(): string {
    this.drain();
    if (this.inside) {
      this._stats.unclosed = true;
      if (this.buf) this.emit(this.buf);
    } else {
      this._stats.discardedChars += this.buf.length;
    }
    this.buf = "";
    this.inside = false;
    return this.spoken.replace(/\s+/g, " ").trim();
  }

  private emit(text: string): void {
    if (!text) return;
    this.spoken += text;
    this._stats.spokenChars += text.length;
    this.onSpeech(text);
  }

  private drain(): void {
    for (;;) {
      if (this.inside) {
        const i = this.buf.indexOf(CLOSE);
        if (i >= 0) {
          this.emit(this.buf.slice(0, i));
          this.buf = this.buf.slice(i + CLOSE.length);
          this.inside = false;
          this.emit(" "); // audible gap between consecutive speech blocks
          continue;
        }
        // Emit all but a suffix that might be the start of </speech>.
        const hold = partialTagSuffix(this.buf, CLOSE);
        const safe = this.buf.length - hold;
        if (safe > 0) {
          this.emit(this.buf.slice(0, safe));
          this.buf = this.buf.slice(safe);
        }
        return;
      }
      const i = this.buf.indexOf(OPEN);
      if (i >= 0) {
        // Text before the tag is silent — discard it.
        this._stats.discardedChars += i;
        this.buf = this.buf.slice(i + OPEN.length);
        this.inside = true;
        this._stats.blocks += 1;
        continue;
      }
      // Keep only a suffix that might be the start of <speech>.
      const hold = partialTagSuffix(this.buf, OPEN);
      const dropped = this.buf.length - hold;
      this._stats.discardedChars += dropped;
      this.buf = hold ? this.buf.slice(this.buf.length - hold) : "";
      return;
    }
  }
}
