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
import { defaultExportError } from "../pipeline/contract";
import { generateDts } from "../pipeline/dts";
import { scriptOneLiner } from "../pipeline/jsdoc";
import type { WorkerPool } from "../executor/pool";
import { HandlerRegistry, HEAD_BYTES, type Claim } from "../adapters/handles";
import { envImportsOf } from "../pipeline/imports";
import { buildOrientation, ORIENTATION_PATH } from "../tools/orientation";
import type { VersionStore } from "../history/versions";
import type { RunLog } from "../history/runlog";

/** Only `tail` is needed here; see tools/orientation. */
type RunLogLike = Pick<RunLog, "tail">;

/**
 * Names the consequence rather than the convention.
 *
 * The old wording ("add a JSDoc block to get typed, described .d.ts output")
 * reads as style advice on a success response, and agent evaluation showed
 * models saving the script and moving on — three graded failures in one run.
 * The cost is concrete and worth stating: an undocumented script is invisible
 * in the catalogue it will be rediscovered through.
 */
export const JSDOC_NUDGE =
  "saved, but with no JSDoc block it has no description in `ls /scripts` and its .d.ts is untyped — " +
  "which is how you (or the next session) will find and reuse it. Add one above the default export: " +
  "/** What it does. @param {{ x: string }} args @returns {Promise<...>} */";

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
  private executor!: WorkerPool;
  private runlog: RunLogLike | null = null;
  /** Serializes mutations so version recording can't lose updates. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly vfs: Vfs,
    readonly limits: EnvLimits,
    readonly versions: VersionStore,
    /**
     * Point the model at the skills once, on the first script it writes
     * without having opened any docs. See {@link nudgeToDocsOnce}.
     */
    private readonly nudgeEnabled = false,
  ) {}

  attachExecutor(executor: WorkerPool): void {
    this.executor = executor;
  }

  /** Optional: lets the orientation file report recent runs. */
  attachRunLog(runlog: RunLogLike): void {
    this.runlog = runlog;
  }

  executorRef(): WorkerPool {
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

  /**
   * `*.test.js` under /scripts. Held to the same default-export contract —
   * `run_tests` has to call something — but not a capability: no `.d.ts` is
   * generated for it and `ls` labels it so a model reading the catalogue
   * doesn't mistake a test for a tool.
   */
  isTestScript(path: string): boolean {
    const p = normalizePath(path);
    return p.endsWith(".test.js") && isUnder(p, "/scripts");
  }

  /** `.js` under /scripts (excluding /scripts/lib/**) must default-export a function. */
  isEnforcedScript(path: string): boolean {
    const p = normalizePath(path);
    if (this.isTestScript(p)) return true;
    return p.endsWith(".js") && isUnder(p, "/scripts") && !isUnder(p, "/scripts/lib");
  }

  /** Enforced AND a capability — the subset that earns a generated `.d.ts`. */
  producesDts(path: string): boolean {
    return this.isEnforcedScript(path) && !this.isTestScript(path);
  }

  /** Any `.js` under /scripts (lib included) is loaded/validated at write time. */
  inScriptZone(path: string): boolean {
    return this.inPipelineScope(path);
  }

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
    // Validation evaluates the module's top level, so it runs in the same
    // terminable worker as any other execution — an infinite loop in a file
    // being *written* is exactly as capable of wedging the host as one being
    // run, and used to be.
    const loaded = await this.executor.execute({ mode: "load", path, readOnly: true, overlay });
    if (!loaded.ok) throw new Error(loaded.error ?? "script failed to load");
    const contract = loaded.contract;
    if (!contract) throw new Error("script failed to load");
    if (this.isEnforcedScript(path)) {
      const contractError = defaultExportError(contract);
      if (contractError) throw new Error(contractError);
    }
    if (!this.producesDts(path)) return { derived: [] }; // lib module or test: load-checked only
    const { dts, hasJsDoc } = generateDts(
      contentText,
      { name: contract.defaultName ?? "", source: contract.defaultSource ?? "function () {}" },
      basename(path),
    );
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

  /**
   * A read under `/std/<name>/` that is not there.
   *
   * Agent evaluation showed models looking up a module by the *symbol* they
   * want: eight reads of `/std/csv/index.d.ts` because a model needed CSV and
   * assumed a module named for it. `csv` is a binding on `env:std`, so the
   * true answer — "no such file" — leaves the model to guess again. Point at
   * the module that actually exports the name.
   */
  private async explainMissingStd(path: string): Promise<string | null> {
    if (!isUnder(path, "/std")) return null;
    const segment = path.split("/")[2];
    if (!segment || this.envModules.has(segment)) return null;

    // `/std/env:documents/index.d.ts` — the model carried the import
    // specifier into the path. It knows the module; it has the directory
    // name wrong, and telling it about exports would be answering a question
    // it did not ask.
    if (segment.startsWith("env:")) {
      const bare = segment.slice(4);
      if (this.envModules.has(bare)) {
        return `/std holds one directory per module, named without the "env:" prefix — you want ${path.replace(`/${segment}/`, `/${bare}/`)}.`;
      }
    }
    const wanted = segment.startsWith("env:") ? segment.slice(4) : segment;
    if (this.envModules.has(wanted)) return null;

    const owners: string[] = [];
    const token = new RegExp(`\\b${wanted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    for (const name of this.moduleDescriptions.keys()) {
      const types = await this.readSource(`/std/${name}/index.d.ts`);
      if (types && token.test(types)) owners.push(name);
    }
    if (owners.length > 0) {
      return (
        `no module named "${wanted}" — but "${wanted}" is exported by ${owners.map((o) => `env:${o}`).join(" and ")}. ` +
        `Read /std/${owners[0]}/index.d.ts, and import it as: import { ${wanted} } from 'env:${owners[0]}'.`
      );
    }
    const all = [...this.moduleDescriptions.keys()].map((n) => `env:${n}`).join(", ");
    return `no module named "${wanted}". Registered modules: ${all}. /std/README.md indexes them.`;
  }

  /**
   * Documentation this session has actually read.
   *
   * Used to gate the first script write. Tracked rather than assumed because
   * the eval showed the two are different things: `/skills` existed, the
   * preamble named it first, and the top of the friction table was still
   * `no module named "csv"` — models wrote the import from memory and ate the
   * error rather than opening the file that answers it.
   */
  private readonly hasRead = new Set<string>();

  /** True once the given doc has been read in this session. */
  seenDoc(path: string): boolean {
    return this.hasRead.has(normalizePath(path));
  }

  async readText(path: string): Promise<string> {
    this.hasRead.add(normalizePath(path));
    // Rebuilt on the read that asks for it, then persisted so `grep` and a
    // subsequent snapshot see the same thing `read_file` just returned.
    if (normalizePath(path) === ORIENTATION_PATH) return this.refreshOrientation();
    const p = normalizePath(path);
    if (!(await this.vfs.exists(p))) {
      const hint = await this.explainMissingStd(p);
      if (hint) throw new Error(hint);
    }
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
      if (this.producesDts(p)) await this.applyDerived([{ remove: this.dtsPathFor(p) }]);
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
      if (op === "mv" && this.producesDts(src)) allEffects.push({ remove: this.dtsPathFor(src) });
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
    } else if (this.producesDts(p)) {
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
          // Labelled, not hidden: a test is worth seeing in the catalogue, but
          // it is not a capability and must not read like one.
          const label = this.isTestScript(p) ? `[test]${line ? ` ${line}` : ""}` : line;
          if (label) item.description = label;
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

  private nudged = false;

  /**
   * Point at the skills once, on the first script written blind.
   *
   * The skills run showed the answer being available and unread: /skills
   * existed, the preamble named it first, and the top of the friction table
   * was still `no module named "csv"`. A model writes the import from memory
   * and meets the answer afterwards, by which point the turn is spent.
   *
   * So this fires exactly once — on the first script write in a session where
   * nothing under /skills or /std has been opened — and then never again,
   * whether or not the model took the hint. It is a signpost, not a gate. A
   * rule that keeps refusing is a rule the model has to work around, and
   * every turn spent working around it is a turn not spent on the task.
   *
   * Called from the model-facing verbs ONLY. A host writing a script through
   * `env.fs`, an adapter deriving one, and the adapter test harness all know
   * what they are importing; interrupting them would charge the friction to
   * the wrong party.
   */
  nudgeToDocsOnce(): void {
    if (!this.nudgeEnabled || this.nudged) return;
    for (const path of this.hasRead) {
      if (path.startsWith("/skills") || path.startsWith("/std")) return;
    }
    // Set before throwing, so this cannot fire twice even if the model
    // ignores it and sends the identical write again.
    this.nudged = true;
    throw new Error(
      `read /skills/README.md before writing your first script — it has the exact import line for every ` +
        `module, and a wrong import is the most common way a run is wasted here. Asked once: send this write ` +
        `again and it will go through.`,
    );
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
   * Resolve a path to raster bytes a vision model can accept.
   *
   * A PNG is already the answer. Anything else has to go through whichever
   * module registered itself as able to rasterize it — and if none did, the
   * error names the package that would, because "cannot view this file" is
   * only useful with the fix attached.
   */
  async imageFor(pathRaw: string): Promise<{ bytes: Uint8Array; mediaType: string; renderedFrom?: string }> {
    const path = normalizePath(pathRaw);
    const stat = await this.vfs.stat(path);
    if (!stat) throw new Error(`no such file or directory: ${path}`);
    if (stat.kind === "dir") throw new Error(`${path} is a directory — view_image needs a file`);

    const bytes = await this.vfs.read(path);
    const direct = rasterType(bytes);
    if (direct) return { bytes, mediaType: direct };

    const head = bytes.subarray(0, HEAD_BYTES);
    const renderer = this.handlers.renderer(path, head);
    if (!renderer) {
      const available = this.handlers.listRenderers().map((r) => `env:${r.module}`);
      throw new Error(
        `${path} is not an image, and ${
          available.length === 0
            ? `no module is registered that can rasterize it. Add glove-env-render to the host's stdlib to view PDFs, decks and Word files`
            : `none of ${available.join(", ")} claims this format`
        }.`,
      );
    }

    // A private scratch directory: rendering to view is not the agent's
    // output, and leaving page PNGs in /out would make the deliverable
    // directory a lie.
    const outDir = `/tmp/.view/${path.replace(/[^a-z0-9]+/gi, "_")}`;
    const result = (await renderer.render(path, outDir, { pages: [1] })) as {
      pages?: Array<{ path?: string }>;
    };
    const first = result?.pages?.[0]?.path;
    if (!first) throw new Error(`env:${renderer.module} rendered no pages from ${path}`);

    const rendered = await this.vfs.read(normalizePath(first));
    const type = rasterType(rendered);
    if (!type) throw new Error(`env:${renderer.module} produced ${first}, which is not a raster image`);
    return { bytes: rendered, mediaType: type, renderedFrom: first };
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

/**
 * Raster format by magic bytes, not by extension.
 *
 * A `.png` that is really a PDF must not be handed to a vision model as a
 * PNG — the provider rejects it, and the error names the media type rather
 * than the actual problem.
 */
function rasterType(bytes: Uint8Array): string | null {
  const at = (i: number) => bytes[i];
  if (bytes.length >= 8 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "image/png";
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46) return "image/gif";
  if (
    bytes.length >= 12 &&
    at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 &&
    at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50
  ) {
    return "image/webp";
  }
  return null;
}
