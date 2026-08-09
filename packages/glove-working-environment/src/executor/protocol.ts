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
  | { kind: "value"; value: unknown }
  | BuilderShape;

/**
 * A constructor whose API is used *fluently*, recorded in the worker and
 * replayed on the host.
 *
 * The libraries worth wrapping — pptxgenjs, docx, exceljs — are all builders:
 * you construct a document, call methods on it and on the objects those
 * return, then write it out. Models have read thousands of examples of
 * exactly that, so any API which is not that shape makes the model translate,
 * and translation is where it burns turns. Measured in the analyst-desk eval:
 * a model reached for `import { slides } from 'env:slides'` because the real
 * library has a class, not a bag of verbs.
 *
 * A live object cannot cross a thread boundary, so nothing does. The worker
 * hands the script a proxy that records `new`/call/set into a flat op list —
 * synchronously, so the API chains exactly like the real one — and the whole
 * list crosses once, when a terminal method is reached. One round trip per
 * document rather than one per call, and no `Atomics` shim.
 */
export interface BuilderShape {
  kind: "builder";
  /** Constructor name, as the script will see it: `PptxGenJS`. */
  name: string;
  /**
   * Which constructor within the family this is — `Paragraph`, `Document`.
   * Equals `name` for a family of one.
   */
  ctor: string;
  /**
   * Constructors sharing this id share one recording, and therefore one ref
   * table.
   *
   * `docx` has no root builder: a document is assembled from constructed
   * values — `new Document({ sections: [{ children: [new Paragraph(...)] }] })`
   * — so a Paragraph must be referable from inside a Document's arguments.
   * That is only possible if both were recorded together.
   */
  family: string;
  /**
   * Methods that finish the document and produce something. Reaching one
   * flushes the recording and returns a promise, so it must be awaited —
   * everything before it is synchronous.
   */
  terminal: string[];
  /**
   * True for a member the script uses without `new` — a library namespace
   * like `docx`'s `Packer`, whose `toBuffer(doc)` is how a document is
   * written. It records like any other object; it is simply never
   * constructed.
   */
  singleton?: boolean;
  /**
   * For a singleton, the names it answers to. Fixed and known, so the worker
   * builds a plain object with exactly these on it rather than a proxy.
   */
  methods: string[];
  /** Static properties carried as data, e.g. `ShapeType`, `AlignH`. */
  statics: Record<string, unknown>;
  /**
   * Data properties on an *instance*, shipped so a read returns the value.
   *
   * Models write `pptx.ShapeType.rect` and `pptx.AlignH.center` constantly,
   * because that is what the library's own examples do. Without this the
   * recorder would treat `ShapeType` as a method and the read would yield a
   * recorder rather than an enum.
   */
  data: Record<string, unknown>;
}

/** Marker an adapter puts on a binding to expose it as a recorded builder. */
export const BUILDER = Symbol.for("glove.builder");

export interface BuilderSpec {
  name: string;
  /** This constructor's own name; equals `name` for a family of one. */
  ctor: string;
  /** Constructors sharing this id share one recording. See {@link BuilderShape}. */
  family: string;
  terminal: string[];
  statics?: Record<string, unknown>;
  data?: Record<string, unknown>;
  /**
   * Method names the host will replay. Everything else is refused.
   *
   * Replaying a name the script chose against a live host object is a sandbox
   * escape — `constructor`, `__proto__`, `valueOf` and anything else reachable
   * on the prototype chain would be callable. The allowlist is the boundary,
   * so it is required rather than defaulted.
   */
  allow: string[];
  /** True for a member used without `new`. See {@link BuilderShape.singleton}. */
  singleton?: boolean;
  /** For a singleton, the names it answers to. See {@link BuilderShape.methods}. */
  methods?: string[];
  /** Replay an op list against the real library. Runs on the host. */
  replay(ops: BuilderOp[]): Promise<unknown>;
}

/**
 * One recorded step. Refs are indices into the run's object table.
 *
 * An argument may itself be a recorded object, encoded as
 * `{ __glove_ref: n }` — see {@link BuilderRef}.
 */
export type BuilderOp =
  | { op: "new"; ref: number; ctor: string; args: unknown[] }
  | { op: "call"; ref: number; target: number; method: string; args: unknown[] }
  | { op: "get"; ref: number; target: number; prop: string }
  | { op: "set"; target: number; prop: string; value: unknown }
  | { op: "end"; target: number; method: string; args: unknown[] };

/**
 * A recorded object appearing inside an argument.
 *
 * The recorder substitutes these on the way out because a Proxy deep-copies
 * to `{}` — so without it, `new Document({ children: [para] })` would arrive
 * on the host with the paragraph silently replaced by an empty object.
 */
export interface BuilderRef {
  __glove_ref: number;
}

export function isBuilderRef(value: unknown): value is BuilderRef {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as BuilderRef).__glove_ref === "number" &&
    Object.keys(value as object).length === 1
  );
}

/** Describe a host namespace so the worker can mirror it. */
export function describeShape(value: unknown, depth = 0): ShapeNode {
  const spec = (value as { [BUILDER]?: BuilderSpec })?.[BUILDER];
  if (spec) {
    return {
      kind: "builder",
      name: spec.name,
      ctor: spec.ctor,
      family: spec.family,
      singleton: spec.singleton === true,
      methods: spec.methods ?? spec.terminal,
      terminal: spec.terminal,
      statics: spec.statics ?? {},
      data: spec.data ?? {},
    };
  }
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
  /**
   * Pure modules the worker imports locally — the mechanism that makes them
   * SYNCHRONOUS, which is their entire point. The host resolved each `url`
   * and already imported it successfully with every `pick` name verified, so
   * by the time this arrives, failure is a broken environment rather than a
   * user mistake.
   */
  pure?: Array<{ name: string; url: string; pick: string[] }>;
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
  /** What `deadline` was derived from, so the worker can name it on failure. */
  budgetMs: number;
  /** Tee console output to the host as it is written. Off unless a host listens. */
  progress?: boolean;
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
  /**
   * What V8 actually gave this thread, in MB — not what the host asked for.
   *
   * The two diverge silently. `resourceLimits` is accepted and reported back
   * verbatim by `worker.resourceLimits` even when a process-level
   * `--max-old-space-size` overrides it, so the only way to know the ceiling
   * is real is to ask the isolate that has to honour it.
   */
  heapLimitMb: number;
}

/** The worker needs something only the host can answer. */
export interface NeedMessage {
  type: "need";
  id: string;
  /**
   * The run this call belongs to, so the host can refuse work from a run it
   * has already reported dead. Absent for calls made outside a run.
   */
  run?: string;
  what: "readSource" | "isEnforcedScript" | "capability" | "builder";
  /** For readSource / isEnforcedScript. */
  path?: string;
  /** For builder: which constructor, and the recorded ops to replay. */
  builder?: string;
  ops?: BuilderOp[];
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

/**
 * Console output from a run in flight, batched.
 *
 * The final `ResultMessage` already carries the whole transcript; this exists
 * because a four-minute render is otherwise silent between `tool_use` and
 * `tool_result`, and a host cannot tell frame 900 of 1800 from a hang.
 */
export interface ProgressMessage {
  type: "progress";
  /** The run this belongs to. */
  id: string;
  lines: Array<{ stream: "stdout" | "stderr"; text: string }>;
}

export type WorkerToHost = ReadyMessage | NeedMessage | ResultMessage | ProgressMessage;
