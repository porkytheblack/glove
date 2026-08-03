/**
 * The host ↔ worker protocol.
 *
 * Scripts execute in a worker thread so the wall-clock limit can be made
 * absolute: `worker.terminate()` stops a thread whatever it is doing,
 * including `for(;;){}` with no `await` in it. Nothing else can. A `vm`
 * timeout covers only a synchronous evaluation, a deadline race needs the
 * event loop to turn, and a capability-call check needs the script to call
 * something — a pure compute loop defeats all three and starves the host
 * process until it is restarted.
 *
 * The executor itself is unchanged and runs inside the worker. Only its four
 * dependencies cross the thread boundary: reading a module's source, the
 * `env:*` namespaces, the enforced-script predicate, and the limits. Every
 * capability binding is already `async`, so this needs no `Atomics` or
 * `SharedArrayBuffer` shim — an ordinary promise per call is enough.
 *
 * Everything here must survive structured clone: no functions, no class
 * instances, no cycles introduced by us.
 */
import type { EnvLimits } from "../types";
import type { ModuleContract } from "../pipeline/contract";

/**
 * The shape of an `env:*` namespace, without its functions.
 *
 * Functions cannot cross a thread boundary, so the host sends a description
 * and the worker rebuilds a matching namespace whose leaves are RPC stubs.
 * `arity` and `name` are carried because the bridge copies them onto the
 * context-realm wrapper, and a capability that arrives as an anonymous
 * zero-arity function is observably wrong.
 */
export type ShapeNode =
  | { kind: "fn"; name: string; arity: number }
  | { kind: "ns"; entries: Record<string, ShapeNode> }
  | { kind: "value"; value: unknown };

/** Describe a host namespace so the worker can mirror it. */
export function describeShape(value: unknown, depth = 0): ShapeNode {
  if (typeof value === "function") {
    return { kind: "fn", name: (value as { name?: string }).name ?? "", arity: (value as { length?: number }).length ?? 0 };
  }
  // Depth-bounded for the same reason the error tagger is: a namespace is a
  // handful of levels, and an unbounded walk over adapter-supplied objects is
  // a hang waiting to happen.
  if (value !== null && typeof value === "object" && depth < 4 && !Array.isArray(value)) {
    const entries: Record<string, ShapeNode> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      // `seal()` sets ns.default = ns; the worker re-creates that itself.
      if (key === "default") continue;
      let child: unknown;
      try {
        child = (value as Record<string, unknown>)[key];
      } catch {
        continue;
      }
      entries[key] = describeShape(child, depth + 1);
    }
    return { kind: "ns", entries };
  }
  return { kind: "value", value: cloneable(value) ? value : String(value) };
}

/** Conservative structured-clone check for the leaf values in a shape. */
function cloneable(value: unknown): boolean {
  if (value === null) return true;
  const t = typeof value;
  return t === "string" || t === "number" || t === "boolean" || t === "bigint" || t === "undefined";
}

// ------------------------------------------------------------ host → worker

export interface StartMessage {
  type: "start";
  limits: EnvLimits;
  /** Namespace name → shape, for both the normal and validation-time sets. */
  shapes: { readWrite: Record<string, ShapeNode>; readOnly: Record<string, ShapeNode> };
}

export interface RunMessage {
  type: "run";
  id: string;
  /** "run" invokes the default export; "load" only evaluates the module. */
  mode: "run" | "load";
  path: string;
  /** Arguments as JSON — a primitive, so nothing structured crosses. */
  argsJson?: string;
  readOnly: boolean;
  /** Uncommitted sources consulted before the VFS, for write-time validation. */
  overlay?: Array<[string, string]>;
  /** Absolute deadline, so the worker's own checks agree with the host's. */
  deadline: number;
}

/** A reply to a `need` the worker raised. */
export interface ReplyMessage {
  type: "reply";
  id: string;
  ok: boolean;
  value?: unknown;
  error?: { message: string; name: string };
}

export type HostToWorker = StartMessage | RunMessage | ReplyMessage;

// ------------------------------------------------------------ worker → host

export interface ReadyMessage {
  type: "ready";
}

/** The worker needs something only the host can answer. */
export interface NeedMessage {
  type: "need";
  id: string;
  what: "readSource" | "isEnforcedScript" | "capability";
  /** For readSource / isEnforcedScript. */
  path?: string;
  /** For capability: which namespace, and the property path within it. */
  module?: string;
  route?: string[];
  args?: unknown[];
  readOnly?: boolean;
}

export interface ResultMessage {
  type: "result";
  id: string;
  ok: boolean;
  /** Serialized with JSON so the host gets plain data, never a live reference. */
  resultJson?: string;
  error?: string;
  stdout: string;
  stderr: string;
  /**
   * Present for mode "load": the module reduced to what the contract check and
   * `.d.ts` generation need. The namespace itself cannot cross a thread.
   */
  contract?: ModuleContract;
}

export type WorkerToHost = ReadyMessage | NeedMessage | ResultMessage;
