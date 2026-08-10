/**
 * Running ffmpeg, and the VFS ↔ real-file dance it requires.
 *
 * ffmpeg is a program that reads and writes real files. The environment's
 * filesystem is in memory. So every operation stages its inputs into a host
 * temp directory, runs, reads the outputs back into the VFS, and removes the
 * directory — including when the run fails, which is when it is easiest to
 * forget.
 *
 * ## The subprocess boundary
 *
 * Every other adapter is a pure library call, and "no process spawning" is
 * one of the environment's stated non-goals. This one spawns a process, so
 * the boundary is worth stating exactly: **the subprocess is started by the
 * host-side adapter and never by sandboxed code.** A script calls
 * `transcode(input, output)` with two VFS paths; it cannot name a program,
 * pass a flag, or see that a process was involved. That is the same trust
 * position as any adapter — `create(vfs)` is the capability boundary and
 * adapters are trusted host code — but it is a bigger deal here and should
 * not be discovered by reading the source.
 *
 * Arguments are always passed as an argv array through `execFile`, never as
 * a shell string. A VFS path containing a space, a quote, or a semicolon is
 * then just a filename. There is no shell to inject into.
 */
import { execFile } from "node:child_process";
import { access, chmod, constants, mkdir, mkdtemp, readFile, rm, stat, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename, extname } from "node:path";

/** Resolved once. Falsy only if the installer packages are unusable. */
let ffmpegPath: string | null = null;
let ffprobePath: string | null = null;

export interface BinaryOverrides {
  ffmpegPath?: string;
  ffprobePath?: string;
}

async function resolveBinaries(overrides: BinaryOverrides): Promise<{ ffmpeg: string; ffprobe: string }> {
  if (overrides.ffmpegPath && overrides.ffprobePath) {
    return { ffmpeg: overrides.ffmpegPath, ffprobe: overrides.ffprobePath };
  }
  if (!ffmpegPath || !ffprobePath) {
    try {
      const [ff, fp] = await Promise.all([
        import("@ffmpeg-installer/ffmpeg"),
        import("@ffprobe-installer/ffprobe"),
      ]);
      ffmpegPath = (ff.default ?? ff).path as string;
      ffprobePath = (fp.default ?? fp).path as string;
    } catch (e) {
      throw new Error(
        `ffmpeg is not available: ${e instanceof Error ? e.message : String(e)}. ` +
          `Install @ffmpeg-installer/ffmpeg and @ffprobe-installer/ffprobe, or pass ffmpegPath/ffprobePath ` +
          `to media() to point at a system build.`,
      );
    }
  }
  const resolved = { ffmpeg: overrides.ffmpegPath ?? ffmpegPath!, ffprobe: overrides.ffprobePath ?? ffprobePath! };
  await Promise.all([ensureExecutable(resolved.ffmpeg), ensureExecutable(resolved.ffprobe)]);
  return resolved;
}

/** Paths already confirmed runnable, so the check costs one stat per process. */
const executable = new Set<string>();

/**
 * Make sure the binary can actually be run.
 *
 * `@ffprobe-installer` ships its binary without the execute bit and relies on
 * a postinstall script to add it — which pnpm does not always run, and which
 * leaves an `EACCES` that says nothing about why. One chmod fixes it; if it
 * cannot, the message has to name the file and the fix, because "spawn
 * /long/path EACCES" does not.
 */
async function ensureExecutable(path: string): Promise<void> {
  if (executable.has(path)) return;
  try {
    await access(path, constants.X_OK);
    executable.add(path);
    return;
  } catch {
    // Not executable (or not there) — try to fix the common case.
  }
  try {
    const mode = (await stat(path)).mode;
    await chmod(path, mode | 0o111);
    await access(path, constants.X_OK);
    executable.add(path);
  } catch (e) {
    throw new Error(
      `${path} is not executable and could not be made so (${e instanceof Error ? e.message : String(e)}). ` +
        `Some package managers drop the execute bit on installed binaries — \`chmod +x\` it, or pass ` +
        `ffmpegPath/ffprobePath to media() pointing at a system build.`,
    );
  }
}

export interface RunOptions extends BinaryOverrides {
  /** Wall-clock budget for one ffmpeg invocation. */
  timeoutMs: number;
  /**
   * Working directory for the process. Only the filter-graph callers need it:
   * a filename inside a filter graph is parsed, not passed through, so `:` and
   * `\` in a path change its meaning. Running from the workspace lets the graph
   * name a bare file we already sanitised, with no escaping to get wrong.
   */
  cwd?: string;
}

interface Output {
  stdout: string;
  stderr: string;
}

function run(binary: string, args: string[], opts: RunOptions): Promise<Output> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      // maxBuffer covers ffprobe's JSON; ffmpeg's own output goes to files.
      { timeout: opts.timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true, ...(opts.cwd ? { cwd: opts.cwd } : {}) },
      (error, stdout, stderr) => {
        if (!error) return resolve({ stdout, stderr });
        if ((error as NodeJS.ErrnoException).code === "ETIMEDOUT" || (error as { killed?: boolean }).killed) {
          return reject(
            new Error(
              `ffmpeg exceeded its ${opts.timeoutMs}ms budget. Media work is slow — raise limits.runTimeoutMs on the ` +
                `environment, or work on a shorter clip.`,
            ),
          );
        }
        // ffmpeg says what is wrong on the LAST few lines of stderr; the
        // preceding hundred are build configuration nobody needs.
        const tail = String(stderr).trim().split("\n").slice(-4).join("\n");
        reject(new Error(tail || error.message));
      },
    );
  });
}

/**
 * A host temp directory holding the real files ffmpeg works on.
 *
 * `stage` copies VFS bytes in; `collect` reads results back out. `dispose`
 * runs in a `finally` — a failed transcode must not leave a gigabyte in
 * /tmp any more than a successful one.
 */
/**
 * The name a caller's path gets inside the workspace.
 *
 * The name only ever contributes an extension and an identity; ffmpeg infers
 * format from content and from explicit flags, not from a name we could get
 * wrong. Reducing it to `[\w.-]` also means the result is safe to write into a
 * filter graph, where a path is parsed rather than passed through.
 */
export function safeName(name: string, fallback = "input"): string {
  return basename(name).replace(/[^\w.-]/g, "_") || fallback;
}

export class Workspace {
  private constructor(readonly dir: string) {}

  static async open(): Promise<Workspace> {
    return new Workspace(await mkdtemp(join(tmpdir(), "glove-media-")));
  }

  /** Write bytes into the workspace under a safe name; returns the host path. */
  async stage(name: string, data: Uint8Array): Promise<string> {
    const path = join(this.dir, safeName(name));
    await writeFile(path, data);
    return path;
  }

  /** Write bytes into a subdirectory of the workspace, creating it. */
  async stageInto(sub: string, name: string, data: Uint8Array): Promise<string> {
    const dir = join(this.dir, basename(sub));
    await mkdir(dir, { recursive: true });
    const path = join(dir, safeName(name));
    await writeFile(path, data);
    return path;
  }

  /** A host path inside the workspace for something ffmpeg will produce. */
  hostPath(name: string): string {
    return join(this.dir, safeName(name, "output"));
  }

  /** Create (and return) a subdirectory for ffmpeg to write into. */
  async outputDir(sub: string): Promise<string> {
    const dir = join(this.dir, basename(sub));
    await mkdir(dir, { recursive: true });
    return dir;
  }

  async collect(hostPath: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(hostPath));
  }

  /** Every file in a subdirectory, sorted — for the frame-extraction case. */
  async collectDir(sub: string): Promise<Array<{ name: string; data: Uint8Array }>> {
    const dir = join(this.dir, sub);
    const names = (await readdir(dir)).sort();
    const out: Array<{ name: string; data: Uint8Array }> = [];
    for (const name of names) out.push({ name, data: new Uint8Array(await readFile(join(dir, name))) });
    return out;
  }

  async dispose(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true }).catch(() => {
      // A temp directory we cannot remove is not worth failing the caller's
      // operation over; the OS will reap it.
    });
  }
}

export async function ffmpeg(args: string[], opts: RunOptions): Promise<void> {
  const { ffmpeg: bin } = await resolveBinaries(opts);
  // -nostdin: ffmpeg otherwise waits on stdin for an overwrite prompt and
  // hangs until the timeout. -y: overwrite, since we always control the path.
  await run(bin, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...args], opts);
}

/**
 * Run ffmpeg for what it PRINTS rather than for the file it writes.
 *
 * The measuring filters put their numbers on stderr and nowhere else —
 * loudnorm's JSON report, ebur128's summary — so this is the one caller that
 * wants ffmpeg talkative. `-nostats` still goes: the per-frame progress line is
 * the noisy half of `info` and none of it is a measurement.
 */
export async function ffmpegReport(args: string[], opts: RunOptions): Promise<string> {
  const { ffmpeg: bin } = await resolveBinaries(opts);
  const { stderr } = await run(bin, ["-hide_banner", "-loglevel", "info", "-nostats", "-nostdin", "-y", ...args], opts);
  return stderr;
}

export async function ffprobe(args: string[], opts: RunOptions): Promise<unknown> {
  const { ffprobe: bin } = await resolveBinaries(opts);
  const { stdout } = await run(bin, ["-hide_banner", "-loglevel", "error", ...args], opts);
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`ffprobe returned output that is not JSON: ${stdout.slice(0, 200)}`);
  }
}

/** The extension of a VFS path, lowercased, without the dot. */
export function extensionOf(path: string): string {
  return extname(path).replace(/^\./, "").toLowerCase();
}
