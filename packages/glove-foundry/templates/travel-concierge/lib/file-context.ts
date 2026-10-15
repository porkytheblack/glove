import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  InMemoryContextAdapter,
  MemorySchema,
  type ContextEntryInput,
  type ContextEntryPatch,
  type Provenance,
} from "glove-memory";

type ContextMemoryState = ReturnType<InMemoryContextAdapter["snapshot"]>;

/**
 * Ambient context (preferences, home airport, who is travelling) saved to a
 * JSON file. Like transcripts, memory has to live outside the run's process to
 * be there on the next message. Single host; use a database adapter for more.
 */
export class FileContextAdapter extends InMemoryContextAdapter {
  private constructor(private readonly file: string, state?: ContextMemoryState) {
    super({ schema: new MemorySchema(), identifier: `file-context:${file}`, ...(state ? { state } : {}) });
  }

  static async open(file: string): Promise<FileContextAdapter> {
    try {
      return new FileContextAdapter(file, JSON.parse(await readFile(file, "utf8")) as ContextMemoryState);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return new FileContextAdapter(file);
      throw error;
    }
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(this.snapshot()));
    await rename(temporary, this.file);
  }

  override async set(entry: ContextEntryInput, provenance: Provenance) {
    const result = await super.set(entry, provenance);
    await this.save();
    return result;
  }
  override async update(id: string, patch: ContextEntryPatch, provenance: Provenance) {
    await super.update(id, patch, provenance);
    await this.save();
  }
  override async unset(id: string, provenance: Provenance) {
    await super.unset(id, provenance);
    await this.save();
  }
  override async setSection(section: string, entries: Array<Omit<ContextEntryInput, "section">>, provenance: Provenance) {
    await super.setSection(section, entries, provenance);
    await this.save();
  }
  override async unsetSection(section: string, provenance: Provenance) {
    await super.unsetSection(section, provenance);
    await this.save();
  }
}
