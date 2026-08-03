/**
 * Development-only worker entry.
 *
 * A published build spawns `worker.js` directly — plain Node ESM, no loader
 * involved. Running from TypeScript source is the awkward case: a worker
 * thread inherits tsx's transform but not its resolver, so the entry's own
 * `import "./executor"` cannot be resolved inside the thread.
 *
 * Registering the loader here and then reaching the real entry through a
 * dynamic import fixes the ordering — static imports are hoisted above any
 * registration, a dynamic one is not. This keeps the test loop running
 * against source while production uses the built path unchanged.
 */
// tsx's own helper: `register("tsx/esm", …)` takes the deprecated --loader
// path and tsx refuses it outright.
const { register } = await import("tsx/esm/api");
register();

await import(new URL("./worker.ts", import.meta.url).href);
