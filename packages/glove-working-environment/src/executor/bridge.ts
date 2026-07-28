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
    return function () {
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

  function bindNamespace(hostObj, seen) {
    seen = seen || new Map();
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
      if (t === "function") out[k] = bind(v, hostObj);
      else if (v !== null && t === "object") out[k] = bindNamespace(v, seen);
      else out[k] = v;
    }
    return out;
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
