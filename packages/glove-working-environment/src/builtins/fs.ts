/**
 * `env:fs` — VFS-scoped programmatic file I/O for scripts. Lets a script
 * loop over fifty inputs without fifty tool calls. Every mutation flows
 * through the same guarded gateway as the model verbs (zones, limits,
 * script pipeline, version recording), so a script can't corrupt derived
 * state either.
 */
import type { EnvFsHandle } from "../types";
import { toBytes } from "../types";
import type { EnvCore } from "../core/env";

export function createFsHandle(core: EnvCore): EnvFsHandle {
  return {
    readFile: (path) => core.readText(path),
    readBytes: (path) => core.readBytes(path),
    writeFile: async (path, content) => {
      await core.write(path, toBytes(content));
    },
    readdir: (path) => core.list(path),
    glob: (pattern) => core.glob(pattern),
    stat: (path) => core.stat(path),
    exists: (path) => core.exists(path),
    mkdir: (path) => core.mkdir(path),
    rm: async (path) => {
      await core.rm(path);
    },
    mv: async (from, to) => {
      await core.mv(from, to);
    },
    cp: async (from, to) => {
      await core.cp(from, to);
    },
  };
}

export const FS_DESCRIPTION = "VFS-scoped file I/O: readFile, writeFile, readdir, glob, stat, mkdir, rm, mv, cp, exists.";

export const FS_TYPES = `/** env:fs — file I/O scoped to the environment's virtual tree. */
export interface VfsEntry {
  name: string;
  kind: "file" | "dir";
  size: number;
}
export interface VfsStat {
  kind: "file" | "dir";
  size: number;
  mtime: number;
}
/** Read a text file (throws on binary content — use readBytes for that). */
export function readFile(path: string): Promise<string>;
/** Read raw bytes. */
export function readBytes(path: string): Promise<Uint8Array>;
/** Write a file (string or bytes), creating parent directories as needed. */
export function writeFile(path: string, content: string | Uint8Array): Promise<void>;
export function readdir(path: string): Promise<VfsEntry[]>;
/** Match file paths: ** any depth, * within a segment, ? one char. */
export function glob(pattern: string): Promise<string[]>;
export function stat(path: string): Promise<VfsStat | null>;
export function exists(path: string): Promise<boolean>;
export function mkdir(path: string): Promise<void>;
export function rm(path: string): Promise<void>;
export function mv(from: string, to: string): Promise<void>;
export function cp(from: string, to: string): Promise<void>;
`;
