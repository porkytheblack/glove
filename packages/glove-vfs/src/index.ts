/**
 * `glove-vfs` — one virtual filesystem for a whole agent.
 *
 * ```ts
 * import { mountFs, inMemoryFs, hostDirectory, withMeta, withAccess } from "glove-vfs";
 *
 * const fs = withAccess(
 *   withMeta(
 *     mountFs([
 *       { at: "/",       fs: inMemoryFs() },
 *       { at: "/corpus", fs: hostDirectory("./docs", { mode: "readonly" }), access: "read" },
 *     ]),
 *     { lexical: true },
 *   ),
 *   { rules: [{ path: "/corpus", access: "read", note: "curated upstream" }] },
 * );
 *
 * // One tree, three consumers:
 * createWorkingEnvironment({ filesystem: fs });   // scripts and verbs
 * vfsResources(fs);                               // glove-memory resource tools
 * session.registerFns(fsFns(fs));                 // execute_js / _lisp / _python
 * ```
 *
 * Layer order matters and reads outside-in: `withAccess` wraps `withMeta`
 * wraps `mountFs`, so a policy governs the metadata surface too rather than
 * being bypassed by it.
 */
export {
  PathError,
  ancestors,
  basename,
  dirname,
  extname,
  globToRegExp,
  isUnder,
  matchGlob,
  normalizePath,
  resolveRelative,
} from "./paths";

export {
  hasMeta,
  hasSearch,
  isSnapshotable,
  looksBinary,
  toBytes,
  toText,
  type GrepMatch,
  type GrepSpec,
  type MetaVfs,
  type SearchVfs,
  type SemanticMatch,
  type SemanticSearchOpts,
  type SnapshotableVfs,
  type Vfs,
  type VfsEntry,
  type VfsLink,
  type VfsMeta,
  type VfsMetadata,
  type VfsProvenance,
  type VfsRecord,
  type VfsSearch,
  type VfsSnapshot,
  type VfsStat,
} from "./types";

export { InMemoryFs, base64ToBytes, bytesToBase64, fromSnapshot, inMemoryFs } from "./backends/memory";
export { HostDirectoryFs, hostDirectory, type HostDirectoryOptions } from "./backends/hostdir";
export {
  CachedRemoteFs,
  cachedRemote,
  type CachedRemoteOptions,
  type ObjectStore,
  type RemoteObject,
} from "./backends/remote";

export { mountFs, type Mount } from "./mount";
export {
  AccessError,
  accessFor,
  describeAccess,
  withAccess,
  type Access,
  type AccessPolicy,
  type AccessRule,
} from "./access";
export { META_INDEX_PATH, withMeta, type Embedder, type WithMetaOptions } from "./meta";
export { cosine, glob, grep, lexicalScore, recencyScore } from "./search";
export { snapshot, restore, copyTree } from "./snapshot";
