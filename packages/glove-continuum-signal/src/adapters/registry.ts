import type { ContinuumAdapter } from "./index.js";

export type AdapterFactory = (options: Record<string, unknown>) => ContinuumAdapter;

const registry = new Map<string, AdapterFactory>();

/**
 * Register an adapter factory by name. Adapters call this at module level so
 * downstream wrappers can construct them by name (e.g. a remote trigger
 * router that needs to materialise the right adapter for a given run kind).
 */
export function registerAdapter(name: string, factory: AdapterFactory): void {
  registry.set(name, factory);
}

export function createAdapter(
  name: string,
  options: Record<string, unknown> = {},
): ContinuumAdapter {
  const factory = registry.get(name);
  if (!factory) {
    throw new Error(
      `Unknown adapter "${name}". Available adapters: ${
        [...registry.keys()].join(", ") || "(none)"
      }. Make sure the adapter package is imported before construction.`,
    );
  }
  return factory(options);
}

export function hasAdapter(name: string): boolean {
  return registry.has(name);
}
