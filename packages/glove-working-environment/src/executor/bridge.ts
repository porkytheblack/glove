/**
 * The realm bridge.
 *
 * Everything a script can touch must be built from the sandbox's OWN
 * intrinsics. If a single host-realm object crosses the boundary, the
 * sandbox is over: `hostValue.constructor.constructor` is the host `Function`
 * constructor, and `Function("return process")()` walks straight out to the
 * real process, host `require`, and the network.
 *
 * So host functions are never handed over directly — they are wrapped by
 * closures created *inside* the context (a closure is not reachable through
 * property access, so the host callee stays hidden), and every value coming
 * back is deep-copied into context-realm objects. Host errors are re-thrown
 * as context-realm `Error`s carrying only the message and name.
 *
 * The bridge source below is evaluated inside the context; the host keeps a
 * reference to the resulting object and then removes it from the context's
 * globals.
 */

/** Host-side view of the bridge object living inside the context. */
export interface Bridge {
  /** Deep-copy a host value into context-realm objects; functions are wrapped. */
  marshal(value: unknown): unknown;
  /** Rebuild a host namespace inside the context, wrapping every function. */
  bindNamespace(hostNamespace: unknown): Record<string, unknown>;
  /** Wrap a host function, marshalling its result (sync and async transparent). */
  bind(hostFn: unknown): (...args: unknown[]) => unknown;
  /**
   * Wrap a host function WITHOUT marshalling its result — for callees that
   * already return context-realm values (module resolution). Errors are still
   * converted.
   */
  bindPassthrough(hostFn: unknown): (...args: unknown[]) => unknown;
  /**
   * Wrap a bound namespace so an unknown property read names the real
   * exports instead of surfacing a bare "not a function".
   */
  guardNamespace(namespace: Record<string, unknown>, label: string): Record<string, unknown>;
  /** Recursively freeze a context-realm object graph. */
  freezeDeep<T>(value: T): T;
  /**
   * Create a module's `__exports` object and install the `__glove_current`
   * record the transformed module body reads. Returns the context-realm
   * exports object; the host reads properties off it after evaluation.
   */
  mkModule(hostImport: unknown, hostPick: unknown, boundConsole: unknown): Record<string, unknown>;
}

export const BRIDGE_SOURCE = `globalThis.__glove_bridge = (function () {
  "use strict";
  var toStr = Object.prototype.toString;

  function errorFrom(e) {
    var msg, name;
    try { msg = (e !== null && e !== undefined && e.message !== undefined) ? String(e.message) : String(e); }
    catch (_) { msg = "error crossing the sandbox boundary"; }
    try { name = (e !== null && e !== undefined && e.name) ? String(e.name) : "Error"; }
    catch (_) { name = "Error"; }
    var err = new Error(msg);
    err.name = name;
    return err;
  }

  function marshal(v, seen) {
    if (v === null) return null;
    var t = typeof v;
    if (t !== "object" && t !== "function") return v;   // primitives carry no identity
    if (t === "function") return bind(v, undefined);
    seen = seen || new Map();
    var hit = seen.get(v);
    if (hit !== undefined) return hit;

    var tag = toStr.call(v);
    if (tag === "[object Uint8Array]" || tag === "[object Uint8ClampedArray]" || tag === "[object Int8Array]") {
      var bytes = new Uint8Array(v.length);
      for (var bi = 0; bi < v.length; bi++) bytes[bi] = v[bi];
      seen.set(v, bytes);
      return bytes;
    }
    if (tag === "[object Date]") { var d = new Date(Number(v)); seen.set(v, d); return d; }
    if (tag === "[object RegExp]") {
      var r = new RegExp(String(v.source), String(v.flags));
      seen.set(v, r);
      return r;
    }
    if (Array.isArray(v)) {                              // cross-realm safe
      var arr = [];
      seen.set(v, arr);
      for (var i = 0; i < v.length; i++) arr[i] = marshal(v[i], seen);
      return arr;
    }
    if (tag === "[object Map]") {
      var m = new Map();
      seen.set(v, m);
      v.forEach(function (val, k) { m.set(marshal(k, seen), marshal(val, seen)); });
      return m;
    }
    if (tag === "[object Set]") {
      var s = new Set();
      seen.set(v, s);
      v.forEach(function (val) { s.add(marshal(val, seen)); });
      return s;
    }
    var out = {};
    seen.set(v, out);
    var keys = Object.keys(v);
    for (var ki = 0; ki < keys.length; ki++) out[keys[ki]] = marshal(v[keys[ki]], seen);
    return out;
  }

  // The host callee is reachable ONLY through this closure — never as a
  // property of the returned function, so scripts cannot get at it.
  function bind(hostFn, hostThis) {
    var wrapped = function () {
      var args = Array.prototype.slice.call(arguments);
      var r;
      try { r = hostFn.apply(hostThis, args); }
      catch (e) { throw errorFrom(e); }
      if (r !== null && r !== undefined && (typeof r === "object" || typeof r === "function") && typeof r.then === "function") {
        return new Promise(function (resolve, reject) {
          r.then(
            function (val) { try { resolve(marshal(val)); } catch (e) { reject(errorFrom(e)); } },
            function (err) { reject(errorFrom(err)); },
          );
        });
      }
      return marshal(r);
    };
    // Carry the callee's observable shape across. Both are primitives, so no
    // host object crosses; without them every capability reads as an
    // anonymous zero-arity function, which is wrong in stack traces and wrong
    // for anything reflecting on arity.
    try {
      Object.defineProperty(wrapped, "name", { value: String(hostFn.name || ""), configurable: true });
      Object.defineProperty(wrapped, "length", { value: Number(hostFn.length) || 0, configurable: true });
    } catch (_) { /* a non-configurable own property is not worth failing over */ }
    return wrapped;
  }

  function bindPassthrough(hostFn) {
    return function () {
      var args = Array.prototype.slice.call(arguments);
      var r;
      try { r = hostFn.apply(undefined, args); }
      catch (e) { throw errorFrom(e); }
      if (r !== null && r !== undefined && (typeof r === "object" || typeof r === "function") && typeof r.then === "function") {
        return new Promise(function (resolve, reject) {
          r.then(resolve, function (err) { reject(errorFrom(err)); });
        });
      }
      return r;
    };
  }

  /*
   * A builder library's constructor, built HERE — inside the context.
   *
   * Models write what the real library looks like: \`new PptxGenJS()\`, then
   * \`addSlide()\`, then \`slide.addText(text, opts)\`. Anything else makes them
   * translate, and translation is where they burn turns.
   *
   * It has to be constructed in-context rather than handed over, because
   * everything crossing this boundary is deep-copied, and a Proxy whose whole
   * behaviour lives in traps has no own keys — a copy of it is \`{}\`. The same
   * property that makes the sandbox a sandbox makes a host-built proxy
   * useless here.
   *
   * Nothing reaches the host until a terminal method. Every call before it is
   * recorded into a flat op list, so the API is synchronous and chains
   * exactly like the real one, and the whole recording crosses once.
   */
  function mkBuilder(meta, boundFlush, family) {
    var terminal = {};
    for (var ti = 0; ti < meta.terminal.length; ti++) terminal[meta.terminal[ti]] = 1;

    /*
     * One recording per family, so constructors that are used together share
     * a ref space. \`new Document({ children: [new Paragraph(...)] })\` only
     * works if the Paragraph and the Document are refs in the same table.
     */
    function ctx() {
      if (family.rec) return family.rec;
      family.rec = { ops: [], next: 0 };
      return family.rec;
    }

    /*
     * Replace recorder nodes anywhere inside an argument with a ref marker.
     *
     * Without this a node passed as an argument is deep-copied on its way to
     * the host, and a Proxy whose behaviour lives in traps has no own keys —
     * so it arrives as \`{}\` and the argument is silently gone. Silent is the
     * problem: the library is handed an empty object and fails somewhere else
     * entirely, or worse, does not fail at all.
     */
    function encode(value, depth) {
      if (value === null || typeof value !== "object" || depth > 8) return value;
      var ref = value[NODE_REF];
      if (typeof ref === "number") return { __glove_ref: ref };
      if (Array.isArray(value)) {
        var arr = [];
        for (var i = 0; i < value.length; i++) arr.push(encode(value[i], depth + 1));
        return arr;
      }
      // Anything that is not a plain object (a Date, a Uint8Array) is left
      // alone: structured clone carries it, and rebuilding it from string
      // keys is how a value gets quietly hollowed out.
      var proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) return value;
      var out = {};
      var keys = Object.keys(value);
      for (var k = 0; k < keys.length; k++) out[keys[k]] = encode(value[keys[k]], depth + 1);
      return out;
    }

    function encodeArgs(args) {
      var out = [];
      for (var i = 0; i < args.length; i++) out.push(encode(args[i], 0));
      return out;
    }

    function Builder() {
      var rec = ctx();
      var ref = rec.next++;
      rec.ops.push({ op: "new", ref: ref, ctor: meta.ctor, args: encodeArgs(Array.prototype.slice.call(arguments)) });
      return node(rec, ref, meta);
    }

    function node(rec, ref, m) {
      return new Proxy({}, {
        get: function (_t, prop) {
          // \`then\` above all: a recorder for it would make the object look
          // thenable and \`await\` would never settle.
          if (prop === NODE_REF) return ref;
          if (typeof prop === "symbol" || PROBE_KEYS[prop]) return undefined;
          var name = String(prop);

          // Enums read as data: \`pptx.ShapeType.rect\`, \`pptx.AlignH.center\`.
          // Recording these as calls is the difference between a model's
          // habitual code working and getting a proxy where it expected a
          // string.
          if (Object.prototype.hasOwnProperty.call(m.data, name)) return m.data[name];

          if (terminal[name]) {
            return function () {
              rec.ops.push({ op: "end", target: ref, method: name, args: encodeArgs(Array.prototype.slice.call(arguments)) });
              var pending = rec.ops;
              family.rec = null; // the recording is spent; a later \`new\` starts fresh
              return boundFlush(pending);
            };
          }

          /*
           * A property read is ambiguous until the script says what it meant:
           * \`ws.addRow(...)\` is a call, \`wb.xlsx.writeFile(...)\` is a read of
           * an object followed by a call on it. Both are ordinary in the real
           * libraries, so neither can be recorded eagerly — this returns
           * something that is callable AND readable, and records whichever
           * happens.
           */
          return member(rec, ref, name, m);
        },
        set: function (_t, prop, value) {
          if (typeof prop !== "symbol") rec.ops.push({ op: "set", target: ref, prop: String(prop), value: encode(value, 0) });
          return true;
        },
        // Must not look like a plain object: a script spreading or logging
        // one would otherwise trigger recordings for every key touched.
        ownKeys: function () { return []; },
        getOwnPropertyDescriptor: function () { return undefined; },
      });
    }

    /*
     * The undecided step between \`obj\` and \`obj.name\`. Calling it records a
     * call; reading through it records the property access first, and only
     * then whatever came next.
     */
    function member(rec, target, name, m) {
      var self = function () {
        var child = rec.next++;
        rec.ops.push({ op: "call", ref: child, target: target, method: name, args: encodeArgs(Array.prototype.slice.call(arguments)) });
        // Every non-terminal call yields a recorder: the real libraries
        // return either a new object (\`addSlide()\`) or \`this\`, and the
        // script cannot tell which until replay.
        return node(rec, child, m);
      };
      return new Proxy(self, {
        apply: function (t, _this, args) { return t.apply(undefined, args); },
        get: function (_t, prop) {
          if (typeof prop === "symbol" || PROBE_KEYS[prop]) return undefined;
          var child = rec.next++;
          rec.ops.push({ op: "get", ref: child, target: target, prop: name });
          return node(rec, child, m)[prop];
        },
        set: function (_t, prop, value) {
          var child = rec.next++;
          rec.ops.push({ op: "get", ref: child, target: target, prop: name });
          if (typeof prop !== "symbol") rec.ops.push({ op: "set", target: child, prop: String(prop), value: encode(value, 0) });
          return true;
        },
      });
    }

    try { Object.defineProperty(Builder, "name", { value: meta.ctor, configurable: true }); } catch (_) {}
    var sk = Object.keys(meta.statics);
    for (var si = 0; si < sk.length; si++) Builder[sk[si]] = meta.statics[sk[si]];
    if (!meta.singleton) return Builder;

    /*
     * A member the script uses without \`new\` — \`Packer.toBuffer(doc)\`.
     *
     * A plain object with the real method names on it, rather than a proxy:
     * its surface is known and fixed, so there is nothing to intercept, and a
     * misspelling then gets the namespace guard's "available: …" list instead
     * of silence. Each method opens its own step in whichever recording is
     * live, so merely importing the module records nothing.
     */
    var singleton = {};
    for (var mi = 0; mi < meta.methods.length; mi++) {
      singleton[meta.methods[mi]] = (function (name) {
        return function () {
          var rec = ctx();
          var ref = rec.next++;
          rec.ops.push({ op: "new", ref: ref, ctor: meta.ctor, args: [] });
          return node(rec, ref, meta)[name].apply(undefined, arguments);
        };
      })(meta.methods[mi]);
    }
    return singleton;
  }

  function bindNamespace(hostObj, seen, families) {
    seen = seen || new Map();
    // Constructors sharing a family share one recording, so that a value
    // built by one can be passed to another.
    families = families || {};
    var hit = seen.get(hostObj);
    if (hit !== undefined) return hit;
    var out = {};
    seen.set(hostObj, out);
    var keys = Object.keys(hostObj);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var v;
      try { v = hostObj[k]; } catch (_) { continue; }
      var t = typeof v;
      if (t === "function" && v.__glove_builder) {
        var meta = v.__glove_builder;
        var fam = families[meta.family];
        if (!fam) { fam = { rec: null }; families[meta.family] = fam; }
        out[k] = mkBuilder(meta, bind(meta.flush, null), fam);
      }
      else if (t === "function") out[k] = bind(v, hostObj);
      else if (v !== null && t === "object") out[k] = bindNamespace(v, seen, families);
      else out[k] = v;
    }
    return out;
  }

  /*
   * Wrap a bound namespace so reading a name it does not have says which
   * names it does. Models guess binding names constantly ("csv.parseRows"
   * for "csv.rows"), and the bare TypeError tells them nothing to correct
   * toward.
   *
   * Built here, inside the context, for the same reason as everything else in
   * this file: a Proxy constructed host-side would hand the sandbox a
   * host-realm object and reopen the escape that tests/sandbox.test.ts exists
   * to catch.
   */
  var PROBE_KEYS = {
    then: 1, toJSON: 1, inspect: 1, __esModule: 1, valueOf: 1, toString: 1,
    constructor: 1, prototype: 1, nodeType: 1, length: 1, name: 1, call: 1, apply: 1,
  };

  /*
   * How a recorder node identifies itself when it turns up inside an
   * argument. A symbol rather than a string so an ordinary object the script
   * built cannot be mistaken for a node.
   */
  var NODE_REF = Symbol("glove.node.ref");

  function guardNamespace(obj, label, seen) {
    if (obj === null || typeof obj !== "object") return obj;
    // Namespaces are cyclic: seal() sets \`ns.default = ns\` so that
    // \`import fs from 'env:fs'\` yields the whole module. Recursing without a
    // cycle guard never returns.
    seen = seen || new Map();
    var hit = seen.get(obj);
    if (hit !== undefined) return hit;

    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      var child = obj[keys[i]];
      if (child !== null && typeof child === "object" && !Array.isArray(child) && child !== obj) {
        obj[keys[i]] = guardNamespace(child, label + "." + keys[i], seen);
      }
    }
    var proxy = new Proxy(obj, {
      get: function (target, key, receiver) {
        // Symbols and the usual duck-typing probes must stay silent, or
        // ordinary things (await, JSON.stringify, spread) start throwing.
        if (typeof key !== "string") return Reflect.get(target, key, receiver);
        if (key in target) return Reflect.get(target, key, receiver);
        if (PROBE_KEYS[key] === 1) return undefined;
        // Same reasoning as exportList() host-side: a wrapped library brings
        // its whole vocabulary, and listing forty names buries the one the
        // model was reaching for. Verbs first, classes counted.
        var available = Object.keys(target).filter(function (k) { return k !== "default"; });
        var verbs = [], classes = [];
        for (var ai = 0; ai < available.length; ai++) {
          (/^[A-Z]/.test(available[ai]) ? classes : verbs).push(available[ai]);
        }
        var shown = (verbs.length > 0 ? verbs : available).slice(0, 16);
        var msg = 'no such export "' + key + '" on ' + label + ' — available: ' + shown.join(", ");
        if (verbs.length > shown.length) msg += ", and " + (verbs.length - shown.length) + " more";
        if (verbs.length > 0 && classes.length > 0) {
          msg += ". It also exports " + classes.length + " classes and enums from the library it wraps (" +
            classes.slice(0, 3).join(", ") + ", …) — see /skills/imports.md";
        }
        throw new TypeError(msg + ".");
      },
    });
    seen.set(obj, proxy);
    return proxy;
  }

  function freezeDeep(v, seen) {
    if (v === null || (typeof v !== "object" && typeof v !== "function")) return v;
    seen = seen || new Set();
    if (seen.has(v)) return v;
    seen.add(v);
    var keys = Reflect.ownKeys(v);
    for (var i = 0; i < keys.length; i++) {
      var child;
      try { child = v[keys[i]]; } catch (_) { continue; }
      freezeDeep(child, seen);
    }
    return Object.freeze(v);
  }

  function mkModule(hostImport, hostPick, boundConsole) {
    var __exports = {};
    globalThis.__glove_current = {
      __exports: __exports,
      __glove_import: bindPassthrough(hostImport),
      __glove_pick: bindPassthrough(hostPick),
      console: boundConsole,
    };
    return __exports;
  }

  return {
    marshal: function (v) { return marshal(v, undefined); },
    bind: function (f) { return bind(f, undefined); },
    bindPassthrough: bindPassthrough,
    bindNamespace: function (o) { return bindNamespace(o, undefined); },
    guardNamespace: function (o, label) { return guardNamespace(o, label, undefined); },
    freezeDeep: function (v) { return freezeDeep(v, undefined); },
    mkModule: mkModule,
  };
})();`;

/**
 * Invocation shim, evaluated per run. Takes the script's (context-realm)
 * default export and a JSON string of arguments — a primitive, so nothing
 * host-realm crosses — and parses the arguments inside the context.
 */
export const INVOKE_SOURCE = `(() => {
  const fn = globalThis.__glove_fn;
  const raw = globalThis.__glove_argsJson;
  return fn(raw === undefined ? undefined : JSON.parse(raw));
})()`;
