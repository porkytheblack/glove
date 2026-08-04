/**
 * The host half of a builder API: replay a recording against the real
 * library.
 *
 * `defineBuilder` is what an adapter author uses to expose a library with its
 * genuine API — `new PptxGenJS()`, `doc.addSlide()`, `slide.addText(...)` —
 * rather than a spec of our own invention. The value of that is not
 * aesthetic: models have read the real library's documentation and examples,
 * and every API that differs from it makes the model translate. The
 * analyst-desk eval caught exactly that, with a model reaching for a name our
 * API did not have because the real library does.
 *
 * Some libraries are not one object with methods on it. `docx` builds a
 * document out of constructed values and writes it with a static —
 * `Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph()] }] }))`
 * — which needs several constructors recording into ONE ref table so that a
 * Paragraph can be named inside a Document's arguments. That is what
 * {@link defineBuilders} is for; `defineBuilder` is the single-constructor
 * case of it.
 */
import { BUILDER, isBuilderRef, type BuilderOp, type BuilderSpec } from "../executor/protocol";

/** How a terminal method turns the recorded object into a result. */
export type Finish = (target: any, args: unknown[]) => Promise<unknown>;

export interface DefineBuilderOptions<T> {
  /** Constructor name as the script sees it. Must match the real library. */
  name: string;
  /** Construct the underlying object. Receives whatever the script passed. */
  construct(args: unknown[]): T | Promise<T>;
  /**
   * Names the script may use on the root object and on anything it returns —
   * methods to call, and properties to read through (`workbook.xlsx`).
   *
   * Required, not optional. Replaying a script-chosen name against a live
   * host object is a sandbox escape: without this, `constructor`,
   * `__proto__`, `valueOf` and every other inherited member is reachable, and
   * `constructor.constructor` is the classic route to the host realm.
   */
  allow: string[];
  /**
   * Terminal methods, and what each one does. These are the only calls that
   * produce a result, and they are where the artifact reaches the VFS —
   * a library's own `writeFile` must never run, or it would write to the
   * host filesystem.
   *
   * The first argument is the object the terminal was called ON, which is not
   * always the root: `workbook.xlsx.writeFile(...)` hands over the `xlsx`
   * member, which is exactly what `writeBuffer()` needs to be called on.
   */
  finish: Record<string, Finish>;
  /** Static properties the script can read off the constructor. */
  statics?: Record<string, unknown>;
  /** Data properties readable off an instance, e.g. `pptx.ShapeType`. */
  data?: Record<string, unknown>;
  /**
   * Rewrite a method's arguments before the library sees them.
   *
   * This is how a path argument is kept inside the sandbox. Libraries that
   * take a filename read it themselves, off the *host* filesystem — so
   * `addImage({ path: '/inbox/logo.png' })` would resolve against the real
   * disk and hand a script whatever it named. Rewriting the argument to
   * inline bytes read through the guarded VFS handle closes that, and it also
   * moves the failure to the call that named the missing file rather than to
   * whichever later call happens to touch it.
   */
  rewrite?: Record<string, (args: unknown[]) => Promise<unknown[]>>;
}

/** One constructor (or one static namespace) within a family. */
export interface BuilderMember {
  /**
   * Build one. Omit for a singleton — a library namespace like `Packer`,
   * which a script uses without `new`.
   */
  construct?(args: unknown[]): unknown | Promise<unknown>;
  /** The live object, for a member the script never constructs. */
  singleton?: unknown;
  /**
   * For a singleton, the names it answers to. Defaults to the family's
   * terminals, which is usually the whole point of one — `Packer` exists to
   * be the thing you call `toBuffer` on.
   *
   * The worker builds a plain object with exactly these on it, so a
   * misspelling gets the usual "available: …" list rather than silence.
   */
  methods?: string[];
  /** Static properties readable off this constructor. */
  statics?: Record<string, unknown>;
  /** Data properties readable off an instance of it. */
  data?: Record<string, unknown>;
}

export interface DefineBuildersOptions {
  /**
   * Shared id for the group. Constructors in one family record into one op
   * list, so a value built by one can be passed to another.
   */
  family: string;
  members: Record<string, BuilderMember>;
  /** See {@link DefineBuilderOptions.allow} — one list for the whole family. */
  allow: string[];
  /** See {@link DefineBuilderOptions.finish}. */
  finish: Record<string, Finish>;
  /** See {@link DefineBuilderOptions.rewrite}. */
  rewrite?: Record<string, (args: unknown[]) => Promise<unknown[]>>;
}

/**
 * Every method a live object actually exposes, walking its prototype chain.
 *
 * The allowlist is meant to be *the library's surface*, so it is read off the
 * library rather than typed out. A hand-written list is wrong the day the
 * dependency adds a method — and being wrong here is invisible, because the
 * symptom is a model writing correct code from the real documentation and
 * being told the method does not exist.
 *
 * Stops at `Object.prototype`, which is where the inherited members a script
 * must not reach begin.
 *
 * Accessors are skipped rather than read. A method is a data property, so
 * nothing is lost, and reading every getter on a live object runs library
 * code for its side effects — exceljs prints a deprecation trace to stderr
 * for `worksheet.tabColor`, which would then appear every time an adapter is
 * created.
 */
export function methodsOf(instance: object): string[] {
  const names = new Set<string>();
  for (let o: object | null = instance; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    for (const name of Object.getOwnPropertyNames(o)) {
      if (suspicious(name)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(o, name);
      if (descriptor && typeof descriptor.value === "function") names.add(name);
    }
  }
  return [...names].sort();
}

/** True for anything reachable on a prototype rather than the library's own API. */
function suspicious(method: string): boolean {
  return (
    method.startsWith("__") ||
    method === "constructor" ||
    method === "prototype" ||
    Object.prototype.hasOwnProperty.call(Object.prototype, method)
  );
}

/**
 * Expose a builder-shaped library to scripts.
 *
 * The returned value is an ordinary object carrying a marker; the shape
 * describer turns it into a recorded constructor in the worker, and the
 * replay below runs on the host.
 */
export function defineBuilder<T extends object>(options: DefineBuilderOptions<T>): unknown {
  const built = defineBuilders({
    family: options.name,
    members: {
      [options.name]: {
        construct: options.construct as (args: unknown[]) => unknown,
        statics: options.statics,
        data: options.data,
      },
    },
    allow: options.allow,
    finish: options.finish,
    rewrite: options.rewrite,
  });
  return built[options.name];
}

/**
 * Expose several interoperating constructors as one recording.
 *
 * Returns a binding per member, each carrying the same replay: the script may
 * build values with any of them and pass them to any other, because they
 * share a ref table.
 */
export function defineBuilders(options: DefineBuildersOptions): Record<string, unknown> {
  const allow = new Set(options.allow);
  const terminal = Object.keys(options.finish);
  const names = Object.keys(options.members);

  if (names.length === 0) {
    throw new Error(`builder family "${options.family}" has no members`);
  }
  for (const name of allow) {
    if (suspicious(name)) {
      throw new Error(
        `builder family "${options.family}" allows "${name}", which is reachable on Object.prototype or is an ` +
          `internal — an allowlist containing it is not an allowlist. List only the library's own names.`,
      );
    }
  }
  for (const [name, member] of Object.entries(options.members)) {
    if (!member.construct && member.singleton === undefined) {
      throw new Error(
        `builder "${name}" in family "${options.family}" has neither construct() nor singleton — ` +
          `a member is either something the script builds with new, or a namespace it uses as-is.`,
      );
    }
  }

  async function replay(ops: BuilderOp[]): Promise<unknown> {
    // Objects the recording refers to, by ref. Only ever populated by
    // replaying an op, so a script cannot name a host object we did not
    // hand out.
    const refs = new Map<number, unknown>();

    /**
     * Substitute recorded objects back into an argument.
     *
     * The recorder replaced them with `{ __glove_ref: n }` on the way out,
     * because a proxy deep-copies to `{}` — so this is what makes
     * `new Document({ children: [para] })` mean the paragraph rather than an
     * empty object.
     */
    const resolve = (value: unknown, depth = 0): unknown => {
      if (value === null || typeof value !== "object" || depth > 8) return value;
      if (isBuilderRef(value)) {
        if (!refs.has(value.__glove_ref)) throw new Error("refers to an object that was never created");
        return refs.get(value.__glove_ref);
      }
      if (Array.isArray(value)) return value.map((v) => resolve(v, depth + 1));
      if (Object.getPrototypeOf(value) !== Object.prototype) return value;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = resolve(v, depth + 1);
      return out;
    };

    for (const [index, op] of ops.entries()) {
      const label = (method: string): string => `call #${index + 1} ${method}()`;
      try {
        if (op.op === "new") {
          const member = options.members[op.ctor];
          if (!member) throw new Error(`"${op.ctor}" is not part of this library`);
          refs.set(
            op.ref,
            member.construct ? await member.construct(op.args.map((a) => resolve(a))) : member.singleton,
          );
          continue;
        }

        const target = refs.get(op.target);
        if (target === undefined || target === null) {
          throw new Error("refers to an object that was never created");
        }

        if (op.op === "set") {
          if (suspicious(op.prop)) throw new Error(`cannot assign to "${op.prop}"`);
          (target as Record<string, unknown>)[op.prop] = resolve(op.value);
          continue;
        }

        if (op.op === "get") {
          if (!allow.has(op.prop)) throw new Error(nameError("property", op.prop));
          refs.set(op.ref, (target as Record<string, unknown>)[op.prop]);
          continue;
        }

        if (op.op === "end") {
          const finish = options.finish[op.method];
          if (!finish) throw new Error(`"${op.method}" is not a way to finish a ${options.family}`);
          return await finish(target, op.args.map((a) => resolve(a)));
        }

        // op.op === "call"
        if (!allow.has(op.method)) throw new Error(nameError("method", op.method));
        let args = op.args.map((a) => resolve(a));
        const rewrite = options.rewrite?.[op.method];
        if (rewrite) args = await rewrite(args);
        const fn = (target as Record<string, unknown>)[op.method];
        if (typeof fn !== "function") {
          throw new Error(`"${op.method}" is not callable on this object`);
        }
        const result = await (fn as (...a: unknown[]) => unknown).apply(target, args);
        // A library that returns nothing is chaining on `this`; recording
        // assumed a new object, so bind the ref to whichever it is.
        refs.set(op.ref, result === undefined || result === null ? target : result);
      } catch (e) {
        // The recording is replayed all at once, so without this the error
        // would point at the flush and not at the line that caused it.
        const method =
          op.op === "new"
            ? `new ${op.ctor}`
            : (op as { method?: string }).method ?? (op as { prop?: string }).prop ?? "?";
        throw new Error(`${label(method)}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    throw new Error(
      `nothing was written — a ${options.family} only produces a file when you call ` +
        `${terminal.map((t) => `${t}()`).join(" or ")}, and it must be awaited.`,
    );
  }

  /**
   * Names what is missing and lists what is not.
   *
   * A bare "no such method" tells a model nothing to correct toward, and the
   * eval showed them re-guessing rather than reading — so the alternatives
   * travel with the refusal.
   */
  function nameError(kind: "method" | "property", name: string): string {
    return (
      `${options.family} has no ${kind} "${name}". Available: ${options.allow.slice(0, 24).join(", ")}` +
      (options.allow.length > 24 ? ", …" : "")
    );
  }

  const out: Record<string, unknown> = {};
  for (const [name, member] of Object.entries(options.members)) {
    const spec: BuilderSpec = {
      name: names.length === 1 ? name : options.family,
      ctor: name,
      family: options.family,
      terminal,
      statics: member.statics,
      data: member.data,
      allow: options.allow,
      singleton: member.singleton !== undefined && !member.construct,
      methods: member.methods ?? terminal,
      replay,
    };
    out[name] = { [BUILDER]: spec };
  }
  return out;
}
