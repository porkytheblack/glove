// ─────────────────────────────────────────────────────────────────────────────
// Speakers
//
// One microphone, several people. A diarizing STT provider (ElevenLabs Scribe
// v3 Live with `diarize: true`) says which words came from which voice, as
// opaque ids ("speaker_0"). `SpeakerTracker` turns those into something an
// agent and a UI can use: stable labels ("Speaker A"), names, who has been
// doing most of the talking, and the text the model reads.
// ─────────────────────────────────────────────────────────────────────────────

import type { SpeakerTurn } from "./adapters/types";

export interface SpeakerInfo {
  /** The provider's id, after any merges. */
  id: string;
  /** What the model and the UI see: the name if one was given, else "Speaker A". */
  label: string;
  /** Name given with `name()`. */
  name?: string;
  /** Time spent talking, from word timings. 0 when the provider sent none. */
  talkMs: number;
  /** Words spoken. */
  words: number;
  /** Runs of speech attributed to this speaker. */
  turns: number;
  /** Share of the talking so far, 0..1 (by time when timings exist, else by words). */
  share: number;
  /** When this speaker last spoke (epoch ms), or null if only seen in draft labels. */
  lastSpokeAt: number | null;
}

/** A speaker turn with the label the model sees. */
export interface LabeledSpeakerTurn extends SpeakerTurn {
  label: string | null;
}

interface Entry {
  id: string;
  ordinal: number;
  name?: string;
  talkMs: number;
  words: number;
  turns: number;
  lastSpokeAt: number | null;
}

interface LogItem {
  id: string;
  ms: number;
  words: number;
  at: number;
}

const LOG_LIMIT = 600;

function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

function defaultLabel(ordinal: number): string {
  return ordinal < 26 ? `Speaker ${String.fromCharCode(65 + ordinal)}` : `Speaker ${ordinal + 1}`;
}

/**
 * Tracks the speakers heard on one microphone.
 *
 * Feed it attributed turns (`observe` for labels only, `record` for labels
 * and stats) and merges; read back labels, stats and the dominant speaker.
 * `GloveVoice` owns one when its STT adapter attributes speakers; it also
 * works alone, for example over the turns `transcribeWithElevenLabs` returns.
 */
export class SpeakerTracker {
  private readonly entries = new Map<string, Entry>();
  private readonly aliases = new Map<string, string>();
  private readonly shown = new Set<string>();
  private readonly mergeNotes: string[] = [];
  private log: LogItem[] = [];
  private nextOrdinal = 0;

  /** The id a provider id refers to now, following merges. */
  resolve(id: string): string {
    let current = id;
    const seen = new Set<string>();
    while (this.aliases.has(current) && !seen.has(current)) {
      seen.add(current);
      current = this.aliases.get(current)!;
    }
    return current;
  }

  /** Distinct speakers known so far. */
  get count(): number {
    return this.entries.size;
  }

  has(id: string): boolean {
    return this.entries.has(this.resolve(id));
  }

  private entry(id: string): Entry {
    const key = this.resolve(id);
    let e = this.entries.get(key);
    if (!e) {
      e = { id: key, ordinal: this.nextOrdinal++, talkMs: 0, words: 0, turns: 0, lastSpokeAt: null };
      this.entries.set(key, e);
    }
    return e;
  }

  /** Register the speakers in these turns without counting them. Returns true if someone new appeared. */
  observe(turns: SpeakerTurn[]): boolean {
    const before = this.entries.size;
    for (const t of turns) if (t.speakerId) this.entry(t.speakerId);
    return this.entries.size !== before;
  }

  /** Register and count these turns. */
  record(turns: SpeakerTurn[], at: number = Date.now()): void {
    for (const t of turns) {
      if (!t.speakerId) continue;
      const e = this.entry(t.speakerId);
      const ms =
        t.start !== undefined && t.end !== undefined && t.end > t.start
          ? Math.round((t.end - t.start) * 1000)
          : 0;
      const words = countWords(t.text);
      e.talkMs += ms;
      e.words += words;
      e.turns += 1;
      e.lastSpokeAt = at;
      this.log.push({ id: e.id, ms, words, at });
    }
    if (this.log.length > LOG_LIMIT) this.log = this.log.slice(-LOG_LIMIT);
  }

  /** The provider decided `from` and `to` are one person. */
  merge(from: string, to: string): void {
    const fromKey = this.resolve(from);
    const toKey = this.resolve(to);
    if (fromKey === toKey) return;
    const source = this.entries.get(fromKey);
    this.aliases.set(fromKey, toKey);
    if (!source) return;

    const target = this.entry(toKey);
    const wasShown = this.shown.has(fromKey);
    const oldLabel = source.name ?? defaultLabel(source.ordinal);
    target.talkMs += source.talkMs;
    target.words += source.words;
    target.turns += source.turns;
    if (source.lastSpokeAt !== null) {
      target.lastSpokeAt = Math.max(target.lastSpokeAt ?? 0, source.lastSpokeAt);
    }
    if (source.name && !target.name) target.name = source.name;
    this.entries.delete(fromKey);
    for (const item of this.log) if (item.id === fromKey) item.id = toKey;

    const newLabel = target.name ?? defaultLabel(target.ordinal);
    if (wasShown && oldLabel !== newLabel) {
      this.mergeNotes.push(`${oldLabel} turned out to be the same person as ${newLabel}.`);
      if (this.mergeNotes.length > 5) this.mergeNotes.shift();
    }
  }

  /**
   * Give a speaker a name. Accepts the provider id ("speaker_0"), the current
   * label ("Speaker A") or a previous name. Returns false if nobody matches.
   */
  name(idOrLabel: string, name: string): boolean {
    const clean = name.trim().replace(/[\[\]\n\r]/g, "").slice(0, 60);
    if (!clean) return false;
    const e = this.find(idOrLabel);
    if (!e) return false;
    e.name = clean;
    return true;
  }

  private find(idOrLabel: string): Entry | null {
    const direct = this.entries.get(this.resolve(idOrLabel));
    if (direct) return direct;
    const wanted = idOrLabel.trim().replace(/^\[|\]$/g, "").toLowerCase();
    for (const e of this.entries.values()) {
      if (defaultLabel(e.ordinal).toLowerCase() === wanted) return e;
      if (e.name && e.name.toLowerCase() === wanted) return e;
    }
    return null;
  }

  /** The label for a provider id: the given name, else "Speaker A". */
  label(id: string): string {
    const e = this.entry(id);
    return e.name ?? defaultLabel(e.ordinal);
  }

  /** Everyone heard so far, in order of first appearance. */
  list(): SpeakerInfo[] {
    const all = [...this.entries.values()].sort((a, b) => a.ordinal - b.ordinal);
    const totalMs = all.reduce((n, e) => n + e.talkMs, 0);
    const totalWords = all.reduce((n, e) => n + e.words, 0);
    return all.map((e) => ({
      id: e.id,
      label: e.name ?? defaultLabel(e.ordinal),
      ...(e.name ? { name: e.name } : {}),
      talkMs: e.talkMs,
      words: e.words,
      turns: e.turns,
      share: totalMs > 0 ? e.talkMs / totalMs : totalWords > 0 ? e.words / totalWords : 0,
      lastSpokeAt: e.lastSpokeAt,
    }));
  }

  /**
   * Who has done most of the talking: overall, or over the last `windowMs`.
   * `share` on the result is the share within that span. Null until someone
   * has been recorded.
   */
  dominant(windowMs?: number, now: number = Date.now()): SpeakerInfo | null {
    const list = this.list();
    if (windowMs === undefined) {
      const top = [...list].sort((a, b) => b.share - a.share)[0];
      return top && top.share > 0 ? top : null;
    }
    const since = now - windowMs;
    const ms = new Map<string, number>();
    const words = new Map<string, number>();
    let totalMs = 0;
    let totalWords = 0;
    for (const item of this.log) {
      if (item.at < since) continue;
      ms.set(item.id, (ms.get(item.id) ?? 0) + item.ms);
      words.set(item.id, (words.get(item.id) ?? 0) + item.words);
      totalMs += item.ms;
      totalWords += item.words;
    }
    const by = totalMs > 0 ? ms : words;
    const total = totalMs > 0 ? totalMs : totalWords;
    if (total <= 0) return null;
    let best: SpeakerInfo | null = null;
    let bestShare = 0;
    for (const info of list) {
      const share = (by.get(info.id) ?? 0) / total;
      if (share > bestShare) {
        bestShare = share;
        best = { ...info, share };
      }
    }
    return best;
  }

  /**
   * Attach labels to turns. Words the provider could not attribute join the
   * turn before them (or after, at the start), and neighbouring turns by the
   * same speaker are joined.
   */
  labelTurns(turns: SpeakerTurn[]): LabeledSpeakerTurn[] {
    const out: LabeledSpeakerTurn[] = [];
    let orphan = "";
    for (const t of turns) {
      const text = t.text.trim();
      if (!text) continue;
      const id = t.speakerId ? this.resolve(t.speakerId) : null;
      const last = out[out.length - 1];
      if (id === null) {
        if (last) last.text = `${last.text} ${text}`;
        else orphan = orphan ? `${orphan} ${text}` : text;
        continue;
      }
      if (last && last.speakerId === id) {
        last.text = `${last.text} ${text}`;
        if (t.end !== undefined) last.end = t.end;
        continue;
      }
      const turn: LabeledSpeakerTurn = {
        speakerId: id,
        label: this.label(id),
        text: orphan ? `${orphan} ${text}` : text,
      };
      orphan = "";
      if (t.start !== undefined) turn.start = t.start;
      if (t.end !== undefined) turn.end = t.end;
      out.push(turn);
    }
    if (orphan) out.push({ speakerId: null, label: null, text: orphan });
    return out;
  }

  /**
   * The text the model reads: one line per speaker turn, each starting with
   * the label in brackets. Remembers which labels the model has now seen.
   */
  format(turns: SpeakerTurn[]): string {
    const labeled = this.labelTurns(turns);
    for (const t of labeled) if (t.speakerId) this.shown.add(t.speakerId);
    return labeled.map((t) => (t.label ? `[${t.label}] ${t.text}` : t.text)).join("\n");
  }

  /**
   * A short note for the model: how to read the labels, who is here, who has
   * done most of the talking, and any merges of labels it has already seen.
   */
  describe(): string {
    const list = this.list();
    const lines = [
      "More than one person is speaking into this microphone. Each line of the user's message " +
        'starts with who said it, in brackets, for example "[Speaker A] hello". The labels come ' +
        "from automatic speaker detection, so they can be wrong, and a line may be said to " +
        "someone else in the room rather than to you.",
    ];
    if (list.length > 0) {
      const parts = list.map((s) =>
        s.share > 0 ? `${s.label} (${Math.round(s.share * 100)}% of the talking)` : s.label,
      );
      lines.push(`Speakers so far: ${parts.join(", ")}.`);
    }
    for (const note of this.mergeNotes) lines.push(note);
    return lines.join("\n");
  }

  /** Forget everyone. */
  reset(): void {
    this.entries.clear();
    this.aliases.clear();
    this.shown.clear();
    this.mergeNotes.length = 0;
    this.log = [];
    this.nextOrdinal = 0;
  }
}

/**
 * A `name_speaker` tool for the agent: when someone says who they are ("I'm
 * Sarah"), the agent records it and their lines are labelled with the name.
 * Fold it once, with a function that reaches the live voice pipeline.
 *
 * @example
 * glove.fold(createNameSpeakerTool((speaker, name) => voice.nameSpeaker(speaker, name)));
 */
export function createNameSpeakerTool(
  nameSpeaker: (speaker: string, name: string) => boolean,
) {
  return {
    name: "name_speaker",
    description:
      "Record a speaker's name once they have said it, so their lines are labelled with it. " +
      'Use the label you see in brackets, for example "Speaker A".',
    jsonSchema: {
      type: "object",
      properties: {
        speaker: { type: "string", description: 'The speaker\'s current label, e.g. "Speaker A".' },
        name: { type: "string", description: "The name they gave." },
      },
      required: ["speaker", "name"],
      additionalProperties: false,
    },
    do: async (input: { speaker: string; name: string }) => {
      const speaker = String(input?.speaker ?? "");
      const name = String(input?.name ?? "");
      return nameSpeaker(speaker, name)
        ? { status: "success" as const, data: { speaker, name } }
        : {
            status: "error" as const,
            data: null,
            message: `No speaker is labelled "${speaker}".`,
          };
    },
  };
}
