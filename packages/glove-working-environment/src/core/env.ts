/**
 * The environment core: every mutation — from a model verb or from a
 * script's `env:fs` call — flows through this single gateway, which
 * enforces the read-only zones, the resource limits, version recording for
 * undo/redo, and the script pipeline (write-time validation + derived
 * sibling `.d.ts` files). Derived state can never drift because there is no
 * second mutation path.
 */
import type { EnvLimits, FileVersionInfo, VfsEntry, VfsStat, Vfs } from "../types";
import { EnvLimitError, looksBinary, toBytes, toText } from "../types";
import { basename, dirname, globToRegExp, isUnder, normalizePath } from "../paths";
import { ScriptContractError } from "../pipeline/contract";
import { generateDts } from "../pipeline/dts";
import { scriptOneLiner } from "../pipeline/jsdoc";
import { newCapture, type ScriptExecutor } from "../executor/executor";
import type { VersionStore } from "../history/versions";

export const JSDOC_NUDGE = "saved; add a JSDoc block above the default export to get typed, described .d.ts output.";

type DerivedAction = { write: string; content: string } | { remove: string };

interface ScriptEffects {
  derived: DerivedAction[];
  nudge?: string;
}

export interface GrepMatch {
  path: string;
  line: number;
  text: string;
  before: string[];
  after: string[];
}

export interface LsEntry {
  path: string;
  name: string;
  kind: "file" | "dir";
  size: number;
  depth: number;
  description?: string;
}

export class EnvCore {
  /** `env:*` namespaces (builtins + adapters), populated during construction. */
  readonly envModules = new Map<string, Record<string, unknown>>();
  /** name → one-liner, for `ls /std` and the tool description. */
  readonly moduleDescriptions = new Map<string, string>();
  private executor!: ScriptExecutor;

  constructor(
    readonly vfs: Vfs,
    readonly limits: EnvLimits,
    readonly versions: VersionStore,
  ) {}

  attachExecutor(executor: ScriptExecutor): void {
    this.executor = executor;
  }

  executorRef(): ScriptExecutor {
    return this.executor;
  }

  // ---------------------------------------------------------------- zones

  /** `.js` under /scripts (excluding /scripts/lib/**) must default-export a function. */
  isEnforcedScript(path: string): boolean {
    const p = normalizePath(path);
    return p.endsWith(".js") && isUnder(p, "/scripts") && !isUnder(p, "/scripts/lib");
  }

  /** Any `.js` under /scripts (lib included) is loaded/validated at write time. */
  private inPipelineScope(path: string): boolean {
    return path.endsWith(".js") && isUnder(path, "/scripts");
  }

  private dtsPathFor(scriptPath: string): string {
    return scriptPath.replace(/\.js$/, ".d.ts");
  }

  private assertMutable(path: string, op: string): void {
    const p = normalizePath(path);
    if (p === "/") throw new Error(`cannot ${op} the root directory`);
    if (isUnder(p, "/.env")) {
      throw new Error(`cannot ${op} ${p}: /.env is maintained by the environment (run history, file versions) and is read-only`);
    }
    if (isUnder(p, "/std")) {
      throw new Error(`cannot ${op} ${p}: /std holds materialized adapter docs and is read-only`);
    }
    if (isUnder(p, "/scripts") && p.endsWith(".d.ts")) {
      throw new Error(
        `cannot ${op} ${p}: .d.ts files under /scripts are derived from their sibling scripts and are regenerated automatically — edit the .js file instead`,
      );
    }
    if (isUnder(p, "/scripts") && p.endsWith(".ts")) {
      throw new Error(
        `cannot ${op} ${p}: TypeScript sources are not executable in this environment — write JavaScript (.js) with JSDoc type annotations instead`,
      );
    }
  }

  // ---------------------------------------------------------------- limits

  private checkFileSize(path: string, bytes: number): void {
    if (bytes > this.limits.maxFileBytes) {
      throw new EnvLimitError(
        `file size limit exceeded: ${path} would be ${bytes} bytes, over the ${this.limits.maxFileBytes}-byte cap (limits.maxFileBytes)`,
      );
    }
  }

  private async checkTotalSize(deltaBytes: number): Promise<void> {
    if (deltaBytes <= 0) return;
    const total = await this.vfs.totalSize();
    if (total + deltaBytes > this.limits.maxVfsBytes) {
      throw new EnvLimitError(
        `environment size limit exceeded: this mutation would grow the tree past ${this.limits.maxVfsBytes} bytes (limits.maxVfsBytes)`,
      );
    }
  }

  // ---------------------------------------------------------------- pipeline

  /**
   * THE post-mutation hook, keyed on extension + location. Validates script
   * content (against an overlay, before anything is committed) and returns
   * the derived writes to apply. Throws — failing the mutation — when the
   * content does not satisfy the script contract.
   */
  private async scriptEffects(path: string, contentText: string, overlayExtra?: Map<string, string>): Promise<ScriptEffects> {
    if (!this.inPipelineScope(path)) return { derived: [] };
    const overlay = new Map(overlayExtra ?? []);
    overlay.set(path, contentText);
    let ns: Record<string, unknown>;
    try {
      ns = await this.executor.loadModule(path, { overlay, capture: newCapture() });
    } catch (e) {
      if (e instanceof ScriptContractError && e.path === path) throw new Error(e.contractMessage);
      throw new Error(e instanceof Error ? e.message : String(e));
    }
    if (!this.isEnforcedScript(path)) return { derived: [] }; // lib module: load-checked only
    const { dts, hasJsDoc } = generateDts(contentText, ns.default as (...a: unknown[]) => unknown, basename(path));
    return {
      derived: [{ write: this.dtsPathFor(path), content: dts }],
      nudge: hasJsDoc ? undefined : JSDOC_NUDGE,
    };
  }

  private async applyDerived(derived: DerivedAction[]): Promise<void> {
    for (const d of derived) {
      if ("write" in d) await this.vfs.write(d.write, toBytes(d.content));
      else if (await this.vfs.exists(d.remove)) await this.vfs.rm(d.remove);
    }
  }

  private async currentContent(path: string): Promise<Uint8Array | null> {
    const stat = await this.vfs.stat(path);
    return stat?.kind === "file" ? await this.vfs.read(path) : null;
  }

  // ---------------------------------------------------------------- reads

  async readBytes(path: string): Promise<Uint8Array> {
    return this.vfs.read(normalizePath(path));
  }

  async readText(path: string): Promise<string> {
    const data = await this.readBytes(path);
    if (looksBinary(data)) {
      throw new Error(
        `${normalizePath(path)} is a binary file (${data.byteLength} bytes) — read_file only handles text. Use a stdlib adapter's describe()/extractors from a script to inspect it.`,
      );
    }
    return toText(data);
  }

  /** Module source for the executor. Null when missing (or a directory). */
  readSource = async (path: string): Promise<string | null> => {
    const stat = await this.vfs.stat(path);
    if (stat?.kind !== "file") return null;
    return toText(await this.vfs.read(path));
  };

  async stat(path: string): Promise<VfsStat | null> {
    return this.vfs.stat(normalizePath(path));
  }

  async exists(path: string): Promise<boolean> {
    return this.vfs.exists(normalizePath(path));
  }

  async list(path: string): Promise<VfsEntry[]> {
    return this.vfs.list(normalizePath(path));
  }

  async glob(pattern: string): Promise<string[]> {
    const re = globToRegExp(pattern);
    return (await this.vfs.files()).filter((f) => re.test(f));
  }

  // ---------------------------------------------------------------- writes

  async write(
    path: string,
    content: string | Uint8Array,
    opts?: { append?: boolean },
  ): Promise<{ bytes: number; nudge?: string; created: boolean }> {
    const p = normalizePath(path);
    this.assertMutable(p, "write");
    if ((await this.vfs.stat(p))?.kind === "dir") throw new Error(`cannot write ${p}: it is a directory`);

    const prior = await this.currentContent(p);
    let bytes = toBytes(content);
    if (opts?.append && prior) {
      const joined = new Uint8Array(prior.byteLength + bytes.byteLength);
      joined.set(prior, 0);
      joined.set(bytes, prior.byteLength);
      bytes = joined;
    }
    this.checkFileSize(p, bytes.byteLength);
    await this.checkTotalSize(bytes.byteLength - (prior?.byteLength ?? 0) + this.versions.versionOverhead(prior));

    const effects = await this.scriptEffects(p, toText(bytes));
    await this.versions.recordMutation(p, prior, opts?.append ? "append" : "write");
    await this.vfs.write(p, bytes);
    await this.applyDerived(effects.derived);
    return { bytes: bytes.byteLength, nudge: effects.nudge, created: prior === null };
  }

  async edit(path: string, oldStr: string, newStr: string): Promise<{ nudge?: string; bytes: number }> {
    const p = normalizePath(path);
    this.assertMutable(p, "edit");
    const stat = await this.vfs.stat(p);
    if (!stat) throw new Error(`no such file: ${p}`);
    if (stat.kind === "dir") throw new Error(`cannot edit ${p}: it is a directory`);
    if (oldStr === "") throw new Error(`old_str must be non-empty`);
    const text = await this.readText(p);

    let count = 0;
    for (let idx = text.indexOf(oldStr); idx !== -1; idx = text.indexOf(oldStr, idx + oldStr.length)) count += 1;
    if (count === 0) throw new Error(`old_str not found in ${p} (0 matches). Read the file and copy the exact text to replace.`);
    if (count > 1) {
      throw new Error(`old_str matches ${count} times in ${p}; it must match exactly once. Include more surrounding context to disambiguate.`);
    }

    const next = text.replace(oldStr, () => newStr);
    const bytes = toBytes(next);
    this.checkFileSize(p, bytes.byteLength);
    const prior = toBytes(text);
    await this.checkTotalSize(bytes.byteLength - prior.byteLength + this.versions.versionOverhead(prior));

    const effects = await this.scriptEffects(p, next);
    await this.versions.recordMutation(p, prior, "edit");
    await this.vfs.write(p, bytes);
    await this.applyDerived(effects.derived);
    return { nudge: effects.nudge, bytes: bytes.byteLength };
  }

  async rm(path: string): Promise<{ removed: string[] }> {
    const p = normalizePath(path);
    this.assertMutable(p, "remove");
    const stat = await this.vfs.stat(p);
    if (!stat) throw new Error(`no such file or directory: ${p}`);

    if (stat.kind === "file") {
      const prior = await this.vfs.read(p);
      await this.versions.recordMutation(p, prior, "rm");
      await this.vfs.rm(p);
      if (this.isEnforcedScript(p)) await this.applyDerived([{ remove: this.dtsPathFor(p) }]);
      return { removed: [p] };
    }

    // Directory: record a version for every contained non-derived file so
    // each is individually undoable, then drop the subtree.
    const prefix = p + "/";
    const contained = (await this.vfs.files()).filter((f) => f.startsWith(prefix));
    const removed: string[] = [];
    for (const f of contained) {
      if (f.endsWith(".d.ts") && isUnder(f, "/scripts")) continue; // derived — regenerated on undo
      await this.versions.recordMutation(f, await this.vfs.read(f), "rm");
      removed.push(f);
    }
    await this.vfs.rm(p);
    return { removed };
  }

  async mkdir(path: string): Promise<void> {
    const p = normalizePath(path);
    this.assertMutable(p, "mkdir");
    await this.vfs.mkdir(p);
  }

  async mv(from: string, to: string): Promise<{ moved: Array<[string, string]>; nudge?: string }> {
    return this.transfer(from, to, "mv");
  }

  async cp(from: string, to: string): Promise<{ moved: Array<[string, string]>; nudge?: string }> {
    return this.transfer(from, to, "cp");
  }

  private async transfer(fromRaw: string, toRaw: string, op: "mv" | "cp"): Promise<{ moved: Array<[string, string]>; nudge?: string }> {
    const from = normalizePath(fromRaw);
    const to = normalizePath(toRaw);
    if (op === "mv") this.assertMutable(from, "move");
    this.assertMutable(to, op === "mv" ? "move to" : "copy to");
    const stat = await this.vfs.stat(from);
    if (!stat) throw new Error(`no such file or directory: ${from}`);
    if (from === to) throw new Error(`source and destination are the same path: ${from}`);
    if (isUnder(to, from) && stat.kind === "dir") throw new Error(`cannot ${op} ${from} into itself`);

    // Build the [source, dest] pairs (a single file, or a whole subtree).
    const pairs: Array<[string, string]> = [];
    if (stat.kind === "file") {
      const destStat = await this.vfs.stat(to);
      if (destStat?.kind === "dir") throw new Error(`destination ${to} is a directory — give the full target path`);
      pairs.push([from, to]);
    } else {
      const prefix = from + "/";
      for (const f of await this.vfs.files()) {
        if (!f.startsWith(prefix)) continue;
        if (f.endsWith(".d.ts") && isUnder(f, "/scripts")) continue; // derived — regenerated at dest
        pairs.push([f, to + "/" + f.slice(prefix.length)]);
      }
      if (pairs.length === 0) throw new Error(`${from} is an empty directory`);
      for (const [, dest] of pairs) this.assertMutable(dest, op === "mv" ? "move to" : "copy to");
    }

    // Validate every destination script against an overlay containing ALL
    // transferred contents, so cross-imports inside a moved subtree resolve.
    const contents = new Map<string, Uint8Array>();
    for (const [src] of pairs) contents.set(src, await this.vfs.read(src));
    const overlay = new Map<string, string>();
    for (const [src, dest] of pairs) {
      const data = contents.get(src)!;
      if (dest.endsWith(".js") && !looksBinary(data)) overlay.set(dest, toText(data));
    }
    const allEffects: Array<{ dest: string; effects: ScriptEffects }> = [];
    let nudge: string | undefined;
    for (const [src, dest] of pairs) {
      const data = contents.get(src)!;
      this.checkFileSize(dest, data.byteLength);
      if (this.inPipelineScope(dest)) {
        const effects = await this.scriptEffects(dest, toText(data), overlay);
        allEffects.push({ dest, effects });
        nudge = nudge ?? effects.nudge;
      }
    }

    let delta = 0;
    for (const [src, dest] of pairs) {
      const data = contents.get(src)!;
      delta += data.byteLength; // dest copy (+ version overhead below)
      if (op === "mv") delta -= data.byteLength;
      const priorDest = await this.currentContent(dest);
      delta += this.versions.versionOverhead(priorDest) + (op === "mv" ? this.versions.versionOverhead(data) : 0);
    }
    await this.checkTotalSize(delta);

    // Commit.
    for (const [src, dest] of pairs) {
      const data = contents.get(src)!;
      const priorDest = await this.currentContent(dest);
      if (op === "mv") {
        await this.versions.recordMutation(src, data, "mv");
        await this.vfs.rm(src);
        if (this.isEnforcedScript(src)) await this.applyDerived([{ remove: this.dtsPathFor(src) }]);
      }
      await this.versions.recordMutation(dest, priorDest, op);
      await this.vfs.write(dest, data);
    }
    if (op === "mv" && stat.kind === "dir" && (await this.vfs.exists(from))) {
      await this.vfs.rm(from); // drop the now-empty source dir (and skipped .d.ts)
    }
    for (const { effects } of allEffects) await this.applyDerived(effects.derived);
    return { moved: pairs, nudge };
  }

  // ---------------------------------------------------------------- undo/redo

  async undo(path: string): Promise<{ restoredOp: string; ts: number; present: boolean }> {
    return this.timeTravel(path, "undo");
  }

  async redo(path: string): Promise<{ restoredOp: string; ts: number; present: boolean }> {
    return this.timeTravel(path, "redo");
  }

  private async timeTravel(pathRaw: string, dir: "undo" | "redo"): Promise<{ restoredOp: string; ts: number; present: boolean }> {
    const p = normalizePath(pathRaw);
    this.assertMutable(p, dir);
    const peek = dir === "undo" ? await this.versions.peekUndo(p) : await this.versions.peekRedo(p);
    if (!peek) throw new Error(`nothing to ${dir} for ${p}`);

    // Validate BEFORE committing the stack move, so a restore that no longer
    // satisfies the script contract (e.g. an import was removed since)
    // fails cleanly and leaves history intact.
    let effects: ScriptEffects = { derived: [] };
    if (peek.content !== null) {
      const data = peek.content;
      this.checkFileSize(p, data.byteLength);
      if (this.inPipelineScope(p) && !looksBinary(data)) {
        effects = await this.scriptEffects(p, toText(data));
      }
    }

    const current = await this.currentContent(p);
    const v = dir === "undo" ? await this.versions.undo(p, current) : await this.versions.redo(p, current);
    if (!v) throw new Error(`nothing to ${dir} for ${p}`);

    if (v.content === null) {
      if (await this.vfs.exists(p)) await this.vfs.rm(p);
      if (this.isEnforcedScript(p)) await this.applyDerived([{ remove: this.dtsPathFor(p) }]);
      return { restoredOp: v.op, ts: v.ts, present: false };
    }
    await this.vfs.write(p, v.content);
    await this.applyDerived(effects.derived);
    return { restoredOp: v.op, ts: v.ts, present: true };
  }

  async historyFor(path: string): Promise<{ undo: FileVersionInfo[]; redo: FileVersionInfo[] }> {
    return this.versions.history(normalizePath(path));
  }

  // ---------------------------------------------------------------- discovery

  /** Recursive listing with per-entry descriptions (scripts: JSDoc one-liner; /std: adapter blurbs). */
  async lsTree(pathRaw: string, depth: number): Promise<LsEntry[]> {
    const root = normalizePath(pathRaw);
    const rootStat = await this.vfs.stat(root);
    if (!rootStat) throw new Error(`no such file or directory: ${root}`);
    if (rootStat.kind === "file") {
      return [{ path: root, name: basename(root), kind: "file", size: rootStat.size, depth: 0 }];
    }
    const out: LsEntry[] = [];
    const walk = async (dir: string, d: number): Promise<void> => {
      if (d >= depth) return;
      for (const entry of await this.vfs.list(dir)) {
        const p = dir === "/" ? `/${entry.name}` : `${dir}/${entry.name}`;
        const item: LsEntry = { path: p, name: entry.name, kind: entry.kind, size: entry.size, depth: d };
        if (entry.kind === "file" && this.isEnforcedScript(p)) {
          const src = await this.readSource(p);
          const line = src ? scriptOneLiner(src) : null;
          if (line) item.description = line;
        } else if (entry.kind === "dir" && dirname(p) === "/std") {
          const desc = this.moduleDescriptions.get(entry.name);
          if (desc) item.description = desc;
        }
        out.push(item);
        if (entry.kind === "dir") await walk(p, d + 1);
      }
    };
    await walk(root, 0);
    return out;
  }

  async grep(
    patternRaw: string,
    pathRaw: string,
    opts?: { glob?: string; context?: number; maxMatches?: number },
  ): Promise<{ matches: GrepMatch[]; truncated: boolean; filesScanned: number }> {
    let pattern: RegExp;
    try {
      pattern = new RegExp(patternRaw);
    } catch (e) {
      throw new Error(`invalid regex ${JSON.stringify(patternRaw)}: ${e instanceof Error ? e.message : String(e)}`);
    }
    const root = normalizePath(pathRaw);
    const rootStat = await this.vfs.stat(root);
    if (!rootStat) throw new Error(`no such file or directory: ${root}`);
    const maxMatches = Math.min(Math.max(opts?.maxMatches ?? 20, 1), 200);
    const context = Math.min(Math.max(opts?.context ?? 0, 0), 10);
    const globRe = opts?.glob ? globToRegExp(opts.glob) : null;

    const candidates =
      rootStat.kind === "file" ? [root] : (await this.vfs.files()).filter((f) => isUnder(f, root));
    const matches: GrepMatch[] = [];
    let truncated = false;
    let filesScanned = 0;
    for (const f of candidates) {
      if (globRe && !globRe.test(f)) continue;
      const data = await this.vfs.read(f);
      if (looksBinary(data)) continue;
      filesScanned += 1;
      const lines = toText(data).split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (!pattern.test(lines[i])) continue;
        if (matches.length >= maxMatches) {
          truncated = true;
          return { matches, truncated, filesScanned };
        }
        matches.push({
          path: f,
          line: i + 1,
          text: lines[i],
          before: lines.slice(Math.max(0, i - context), i),
          after: lines.slice(i + 1, i + 1 + context),
        });
      }
    }
    return { matches, truncated, filesScanned };
  }

  /** One-line JSDoc description of a script (for listings). */
  async describeScript(path: string): Promise<string | null> {
    const src = await this.readSource(normalizePath(path));
    return src ? scriptOneLiner(src) : null;
  }
}
