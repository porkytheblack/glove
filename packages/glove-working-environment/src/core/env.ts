/**
 * The environment core: every mutation — from a model verb or from a
 * script's `env:fs` call — flows through this single gateway, which enforces
 * the read-only zones, the resource limits, version recording for
 * undo/redo, and the script pipeline (write-time validation + derived
 * sibling `.d.ts` files).
 *
 * Three properties are load-bearing and easy to lose:
 *
 * 1. **Commit atomically.** Everything that can fail — validation, derived
 *    `.d.ts` generation, destination writability, size accounting — is
 *    checked BEFORE the first byte is written. A verb that reports failure
 *    must not have changed the tree, or the model's mental model of its own
 *    filesystem silently diverges from reality.
 * 2. **Validation must not mutate.** Write-time validation works by
 *    executing the module's top level, so it runs with a READ-ONLY
 *    filesystem handle. Otherwise a rejected `write_file` could still delete
 *    files, and a script could plant state that breaks the environment.
 * 3. **Serialize mutations.** Version recording is read-modify-write; two
 *    concurrent writers that both capture the same "prior" silently destroy
 *    undo history. All mutations run through one queue.
 */
import type { EnvLimits, FileVersionInfo, VfsEntry, VfsStat, Vfs } from "../types";
import { EnvLimitError, looksBinary, toBytes, toText } from "../types";
import { basename, dirname, globToRegExp, isUnder, normalizePath } from "../paths";
import { ScriptContractError } from "../pipeline/contract";
import { generateDts } from "../pipeline/dts";
import { scriptOneLiner } from "../pipeline/jsdoc";
import { newCapture, type ScriptExecutor } from "../executor/executor";
import { HandlerRegistry, HEAD_BYTES, type Claim } from "../adapters/handles";
import { envImportsOf } from "../pipeline/imports";
import { buildOrientation, ORIENTATION_PATH } from "../tools/orientation";
import type { VersionStore } from "../history/versions";
import type { RunLog } from "../history/runlog";

/** Only `tail` is needed here; see tools/orientation. */
type RunLogLike = Pick<RunLog, "tail">;

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
  /** The same namespaces bound to a read-only filesystem, used for validation. */
  readonly envModulesReadOnly = new Map<string, Record<string, unknown>>();
  /** name → one-liner, for `ls /std` and the tool description. */
  readonly moduleDescriptions = new Map<string, string>();
  /** Which adapter understands which file — shared by `describe` and `ls`. */
  readonly handlers = new HandlerRegistry();
  private executor!: ScriptExecutor;
  private runlog: RunLogLike | null = null;
  /** Serializes mutations so version recording can't lose updates. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly vfs: Vfs,
    readonly limits: EnvLimits,
    readonly versions: VersionStore,
  ) {}

  attachExecutor(executor: ScriptExecutor): void {
    this.executor = executor;
  }

  /** Optional: lets the orientation file report recent runs. */
  attachRunLog(runlog: RunLogLike): void {
    this.runlog = runlog;
  }

  executorRef(): ScriptExecutor {
    return this.executor;
  }

  /**
   * Run a mutation with exclusive access. Validation uses a read-only
   * filesystem, so a script executing inside a held lock can never take the
   * lock again — this cannot deadlock.
   */
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn, fn);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
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

  /** True when the path IS, or lives beneath, a generated `.d.ts` location. */
  private isDerivedPath(path: string): boolean {
    const p = normalizePath(path);
    if (!isUnder(p, "/scripts")) return false;
    // A directory standing where a `.d.ts` belongs would otherwise let a
    // recursive remove run over user data that was never versioned.
    return p.split("/").some((seg) => seg.endsWith(".d.ts"));
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
    if (this.isDerivedPath(p)) {
      throw new Error(
        `cannot ${op} ${p}: .d.ts paths under /scripts are derived from their sibling scripts and are regenerated automatically — edit the .js file instead`,
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
   *
   * Runs with a read-only filesystem: validation executes the module's top
   * level, and a rejected write must leave no trace.
   */
  private async scriptEffects(path: string, contentText: string, overlayExtra?: Map<string, string>): Promise<ScriptEffects> {
    if (!this.inPipelineScope(path)) return { derived: [] };
    const overlay = new Map(overlayExtra ?? []);
    overlay.set(path, contentText);
    let ns: Record<string, unknown>;
    try {
      ns = await this.executor.loadModule(path, { overlay, capture: newCapture(), readOnly: true });
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

  /**
   * Verify every derived action can be applied, and report the bytes it will
   * add. Called before the primary write so a derived failure can't leave a
   * committed `.js` with a stale or missing `.d.ts`.
   */
  private async prepareDerived(derived: DerivedAction[]): Promise<number> {
    let delta = 0;
    for (const d of derived) {
      if ("write" in d) {
        const stat = await this.vfs.stat(d.write);
        if (stat?.kind === "dir") {
          throw new Error(`cannot generate ${d.write}: a directory exists at that path`);
        }
        const bytes = toBytes(d.content).byteLength;
        this.checkFileSize(d.write, bytes);
        delta += bytes - (stat?.size ?? 0);
      } else {
        const stat = await this.vfs.stat(d.remove);
        if (stat?.kind === "file") delta -= stat.size;
      }
    }
    return delta;
  }

  private async applyDerived(derived: DerivedAction[]): Promise<void> {
    for (const d of derived) {
      if ("write" in d) {
        await this.vfs.write(d.write, toBytes(d.content));
      } else {
        // Only ever remove a FILE. `vfs.rm` is recursive, and a directory
        // sitting at a derived path would take unversioned user data with it.
        const stat = await this.vfs.stat(d.remove);
        if (stat?.kind === "file") await this.vfs.rm(d.remove);
      }
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
    // Rebuilt on the read that asks for it, then persisted so `grep` and a
    // subsequent snapshot see the same thing `read_file` just returned.
    if (normalizePath(path) === ORIENTATION_PATH) return this.refreshOrientation();
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

  write(
    path: string,
    content: string | Uint8Array,
    opts?: { append?: boolean },
  ): Promise<{ bytes: number; nudge?: string; created: boolean }> {
    return this.serialize(() => this.writeInner(path, content, opts));
  }

  private async writeInner(
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

    // Everything that can fail happens before the first write.
    const effects = await this.scriptEffects(p, toText(bytes));
    const derivedDelta = await this.prepareDerived(effects.derived);
    await this.checkTotalSize(
      bytes.byteLength - (prior?.byteLength ?? 0) + derivedDelta + this.versions.versionOverhead(prior),
    );

    await this.versions.recordMutation(p, prior, opts?.append ? "append" : "write");
    await this.vfs.write(p, bytes);
    await this.applyDerived(effects.derived);
    return { bytes: bytes.byteLength, nudge: effects.nudge, created: prior === null };
  }

  edit(path: string, oldStr: string, newStr: string): Promise<{ nudge?: string; bytes: number }> {
    return this.serialize(() => this.editInner(path, oldStr, newStr));
  }

  private async editInner(path: string, oldStr: string, newStr: string): Promise<{ nudge?: string; bytes: number }> {
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

    const effects = await this.scriptEffects(p, next);
    const derivedDelta = await this.prepareDerived(effects.derived);
    await this.checkTotalSize(bytes.byteLength - prior.byteLength + derivedDelta + this.versions.versionOverhead(prior));

    await this.versions.recordMutation(p, prior, "edit");
    await this.vfs.write(p, bytes);
    await this.applyDerived(effects.derived);
    return { nudge: effects.nudge, bytes: bytes.byteLength };
  }

  rm(path: string): Promise<{ removed: string[] }> {
    return this.serialize(() => this.rmInner(path));
  }

  private async rmInner(path: string): Promise<{ removed: string[] }> {
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

  mkdir(path: string): Promise<void> {
    return this.serialize(async () => {
      const p = normalizePath(path);
      this.assertMutable(p, "mkdir");
      await this.vfs.mkdir(p);
    });
  }

  mv(from: string, to: string): Promise<{ moved: Array<[string, string]>; nudge?: string }> {
    return this.serialize(() => this.transfer(from, to, "mv"));
  }

  cp(from: string, to: string): Promise<{ moved: Array<[string, string]>; nudge?: string }> {
    return this.serialize(() => this.transfer(from, to, "cp"));
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

    // Every destination must be writable BEFORE anything moves, or a failure
    // partway through would leave the tree half-transferred.
    for (const [, dest] of pairs) {
      if ((await this.vfs.stat(dest))?.kind === "dir") {
        throw new Error(`cannot ${op} onto ${dest}: it is a directory`);
      }
      for (let dir = dirname(dest); dir !== "/"; dir = dirname(dir)) {
        if ((await this.vfs.stat(dir))?.kind === "file") {
          throw new Error(`cannot ${op} to ${dest}: ${dir} is a file`);
        }
      }
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
    const allEffects: DerivedAction[] = [];
    let nudge: string | undefined;
    for (const [src, dest] of pairs) {
      const data = contents.get(src)!;
      this.checkFileSize(dest, data.byteLength);
      if (this.inPipelineScope(dest)) {
        const effects = await this.scriptEffects(dest, toText(data), overlay);
        allEffects.push(...effects.derived);
        nudge = nudge ?? effects.nudge;
      }
      if (op === "mv" && this.isEnforcedScript(src)) allEffects.push({ remove: this.dtsPathFor(src) });
    }
    const derivedDelta = await this.prepareDerived(allEffects);

    let delta = derivedDelta;
    for (const [src, dest] of pairs) {
      const data = contents.get(src)!;
      const priorDest = await this.currentContent(dest);
      delta += data.byteLength - (priorDest?.byteLength ?? 0);
      if (op === "mv") delta -= data.byteLength;
      delta += this.versions.versionOverhead(priorDest) + (op === "mv" ? this.versions.versionOverhead(data) : 0);
    }
    await this.checkTotalSize(delta);

    // Commit: write every destination FIRST, then remove sources. A failure
    // mid-way can leave an extra copy, never a hole.
    for (const [src, dest] of pairs) {
      const data = contents.get(src)!;
      const priorDest = await this.currentContent(dest);
      await this.versions.recordMutation(dest, priorDest, op);
      await this.vfs.write(dest, data);
    }
    if (op === "mv") {
      for (const [src] of pairs) {
        await this.versions.recordMutation(src, contents.get(src)!, "mv");
        await this.vfs.rm(src);
      }
      if (stat.kind === "dir" && (await this.vfs.exists(from))) {
        await this.vfs.rm(from); // drop the now-empty source dir (and skipped .d.ts)
      }
    }
    await this.applyDerived(allEffects);
    return { moved: pairs, nudge };
  }

  // ---------------------------------------------------------------- undo/redo

  undo(path: string): Promise<{ restoredOp: string; ts: number; present: boolean }> {
    return this.serialize(() => this.timeTravel(path, "undo"));
  }

  redo(path: string): Promise<{ restoredOp: string; ts: number; present: boolean }> {
    return this.serialize(() => this.timeTravel(path, "redo"));
  }

  private async timeTravel(pathRaw: string, dir: "undo" | "redo"): Promise<{ restoredOp: string; ts: number; present: boolean }> {
    const p = normalizePath(pathRaw);
    this.assertMutable(p, dir);
    const peek = dir === "undo" ? await this.versions.peekUndo(p) : await this.versions.peekRedo(p);
    if (!peek) throw new Error(`nothing to ${dir} for ${p}`);

    // Validate BEFORE committing the stack move, so a restore that no longer
    // satisfies the script contract (or whose derived write can't be applied)
    // fails cleanly and leaves both the tree and the history intact.
    let effects: ScriptEffects = { derived: [] };
    if (peek.content !== null) {
      const data = peek.content;
      this.checkFileSize(p, data.byteLength);
      if (this.inPipelineScope(p) && !looksBinary(data)) {
        effects = await this.scriptEffects(p, toText(data));
      }
    } else if (this.isEnforcedScript(p)) {
      effects = { derived: [{ remove: this.dtsPathFor(p) }] };
    }
    await this.prepareDerived(effects.derived);
    if ((await this.vfs.stat(p))?.kind === "dir") throw new Error(`cannot ${dir} ${p}: it is a directory`);

    const current = await this.currentContent(p);
    const v = dir === "undo" ? await this.versions.undo(p, current) : await this.versions.redo(p, current);
    if (!v) throw new Error(`nothing to ${dir} for ${p}`);

    if (v.content === null) {
      if (await this.vfs.exists(p)) await this.vfs.rm(p);
      await this.applyDerived(effects.derived);
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
        } else if (entry.kind === "file") {
          // A directory of mounted binaries is otherwise fifty opaque names.
          // Naming the module that can open each one is the cheap half of
          // orientation — head bytes only, no parsing — and `describe` is
          // there for the expensive half, one file at a time.
          const claim = await this.claimFor(p);
          if (claim) item.description = `open with env:${claim.handler.module}`;
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

  /**
   * `env:` module name → the stored scripts that import it.
   *
   * Read straight off the tree rather than from snapshot metadata, so it is
   * equally true for a restored snapshot, a host-supplied persistent
   * filesystem, and a tree the agent has been editing all session.
   */
  async moduleUsage(): Promise<Map<string, string[]>> {
    const usage = new Map<string, string[]>();
    for (const path of (await this.glob("/scripts/**/*.js")).sort()) {
      const src = await this.readSource(path);
      if (src === null) continue;
      for (const mod of envImportsOf(src)) {
        const list = usage.get(mod) ?? [];
        list.push(path);
        usage.set(mod, list);
      }
    }
    return usage;
  }

  /**
   * Regenerate `/.env/orientation.md` and return it, persisting a copy so
   * `grep` and a later snapshot see what `read_file` just returned.
   *
   * Two things this deliberately does NOT do. It is not written at startup:
   * an environment that never reads it should not pay ~1KB of `maxVfsBytes`
   * for a file nobody asked for. And it never fails a read — a tree at its
   * size cap still gets the text, just without the persisted copy, because
   * "you are out of space" is exactly when orientation is most worth having.
   */
  async refreshOrientation(): Promise<string> {
    const text = await buildOrientation(this, this.runlog);
    const bytes = toBytes(text);
    // Written directly: /.env is environment-maintained and `assertMutable`
    // exists precisely to stop anyone else writing here — which also means
    // the usual size accounting has to be done by hand.
    try {
      const prior = (await this.vfs.stat(ORIENTATION_PATH))?.size ?? 0;
      const delta = bytes.byteLength - prior;
      if (delta <= 0 || (await this.vfs.totalSize()) + delta <= this.limits.maxVfsBytes) {
        await this.vfs.write(ORIENTATION_PATH, bytes);
      }
    } catch {
      // Orientation is a convenience; a filesystem that refuses the write
      // must not turn a read into a failure.
    }
    return text;
  }

  /** Which adapter claims this file, if any. Reads only the head bytes. */
  async claimFor(path: string): Promise<Claim | null> {
    if (this.handlers.list().length === 0) return null;
    const p = normalizePath(path);
    const stat = await this.vfs.stat(p);
    if (stat?.kind !== "file") return null;
    const head = (await this.vfs.read(p)).subarray(0, HEAD_BYTES);
    return this.handlers.claim(p, head);
  }

  /**
   * Summarise any file: the claiming adapter's own `describe()` when one
   * exists, otherwise a generic structural summary.
   *
   * The fallback matters as much as the dispatch. "No adapter handles this"
   * is a true answer that leaves the model exactly where it started, whereas
   * size + text/binary + a first-lines peek is enough to decide what to do
   * next with almost anything.
   */
  async describeFile(pathRaw: string): Promise<Record<string, unknown>> {
    const path = normalizePath(pathRaw);
    const stat = await this.vfs.stat(path);
    if (!stat) throw new Error(`no such file or directory: ${path}`);
    if (stat.kind === "dir") {
      const entries = await this.vfs.list(path);
      return {
        path,
        kind: "directory",
        entries: entries.length,
        files: entries.filter((e) => e.kind === "file").length,
        directories: entries.filter((e) => e.kind === "dir").length,
      };
    }

    const claim = await this.claimFor(path);
    if (claim?.handler.describe) {
      try {
        const summary = await claim.handler.describe(path);
        if (summary !== null && typeof summary === "object") {
          return { path, module: `env:${claim.handler.module}`, ...(summary as Record<string, unknown>) };
        }
        return { path, module: `env:${claim.handler.module}`, summary };
      } catch (e) {
        // An adapter that cannot parse a file it claimed is a fact worth
        // reporting, not a reason to fail: the generic summary below still
        // answers "what am I holding", and the reason it failed to parse is
        // often the actual answer (truncated download, wrong format, DRM).
        const generic = await this.genericSummary(path, stat.size);
        return {
          ...generic,
          module: `env:${claim.handler.module}`,
          moduleError: e instanceof Error ? e.message : String(e),
        };
      }
    }

    const generic = await this.genericSummary(path, stat.size);
    return claim ? { ...generic, module: `env:${claim.handler.module}` } : generic;
  }

  private async genericSummary(path: string, size: number): Promise<Record<string, unknown>> {
    const data = await this.vfs.read(path);
    const binary = looksBinary(data);
    const base: Record<string, unknown> = { path, kind: "file", bytes: size, binary };
    if (binary) {
      const head = data.subarray(0, 8);
      base.head = [...head].map((b) => b.toString(16).padStart(2, "0")).join(" ");
      const modules = this.handlers
        .list()
        .map((h) => `env:${h.module}`)
        .join(", ");
      base.note = modules
        ? `no registered module claims this file — registered handlers: ${modules}`
        : `no registered module claims this file`;
      return base;
    }
    const text = toText(data);
    const lines = text.split("\n");
    base.lines = lines.length;
    base.preview = lines.slice(0, 5).join("\n").slice(0, 500);
    return base;
  }
}
