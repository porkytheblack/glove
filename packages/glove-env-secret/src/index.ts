import { defineAdapter } from "glove-working-environment";

/** Host-owned storage. Scope one store to the tenant/environment that owns it. */
export interface SecretStore {
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<boolean>;
  list(): Promise<string[]>;
}

/** A reference identifies a key; it does not grant access to its value. */
export interface SecretRef { kind: "env:secret"; name: string }

export function secretRef(name: string): SecretRef {
  validateName(name);
  return { kind: "env:secret", name };
}

function validateName(name: string) {
  if (typeof name !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,199}$/.test(name)) {
    throw new TypeError("Secret names must be 1–200 letters, digits, dots, underscores, slashes or hyphens, starting with a letter or digit");
  }
}

/** In-memory host storage, never serialized into the VFS. Not encrypted at rest. */
export function createMemorySecretStore(initial: Record<string, string> = {}): SecretStore {
  const values = new Map<string, string>();
  const checkValue = (value: string) => {
    if (typeof value !== "string") throw new TypeError("A secret value must be a string");
  };
  for (const [name, value] of Object.entries(initial)) {
    validateName(name); checkValue(value); values.set(name, value);
  }
  return {
    async get(name) { validateName(name); return values.get(name) ?? null; },
    async set(name, value) { validateName(name); checkValue(value); values.set(name, value); },
    async delete(name) { validateName(name); return values.delete(name); },
    async list() { return [...values.keys()].sort(); },
  };
}

export interface SecretOptions {
  /** Omit for a fresh in-memory store per environment. Explicit stores may be shared. */
  store?: SecretStore;
  /** Names scripts may access. Omit for all names in the supplied store. */
  names?: string[];
  /** Allow get() to return plaintext to a script. Default false. */
  allowReveal?: boolean;
  /** Allow set() and delete() from scripts. Default false. */
  allowWrite?: boolean;
}

export const SECRET_TYPES = `
export interface SecretRef { kind: "env:secret"; name: string }
/** Names only, never secret values. */
export function list(): Promise<string[]>;
export function has(name: string): Promise<boolean>;
export function ref(name: string): Promise<SecretRef>;
/** Requires host allowReveal. Returning this value exposes it to history/model output. */
export function get(name: string): Promise<string | null>;
/** Requires host allowWrite. Prefer host-side provisioning to avoid recording input secrets. */
export function set(name: string, value: string): Promise<SecretRef>;
export function remove(name: string): Promise<boolean>;
`;

export const SECRET_DOCS = `# env:secret

A host-backed keystore outside the virtual filesystem. Use list(), has(name)
and ref(name) to discover keys without revealing their values. References are
identifiers, not access grants; each consuming adapter needs its own host policy.

get(name) requires the host's allowReveal option. set(name, value) and
remove(name) require allowWrite. Missing keys return null from get and false
from has/remove; ref requires an existing key. Empty string values are valid.
All calls belong inside the script's default export, not at module top level.

The default store is ephemeral and isolated per environment. Hosts can supply
a persistent SecretStore backed by their own vault/database/keychain and scope
it to a tenant. VFS snapshots do not back up the store. Names may appear in
results; keep names free of sensitive values. Revealing a value, embedding it
in a saved script, or passing it as a script argument can record it in history.
Provision sensitive values through the host store and use configured credential
aliases in env:fetch instead of retrieving tokens into scripts.
`;

export function secret(options: SecretOptions = {}) {
  const names = options.names === undefined ? undefined : new Set(options.names);
  names?.forEach(validateName);
  return defineAdapter({
    name: "secret",
    description: "Host-backed keystore: list keys and use references; plaintext reads and writes require host opt-in.",
    types: SECRET_TYPES,
    docs: SECRET_DOCS,
    create(_vfs, ctx) {
      const store = options.store ?? createMemorySecretStore();
      function check(name?: string) {
        if (ctx.readOnly) throw new Error("Secret operations are unavailable during script validation; call inside the default export");
        if (name !== undefined) {
          validateName(name);
          if (names && !names.has(name)) throw new Error("Secret key is not permitted by the host");
        }
      }
      async function call<T>(fn: () => Promise<T>): Promise<T> {
        try { return await fn(); }
        catch { throw new Error("Secret store operation failed"); }
      }
      return {
        async list(): Promise<string[]> {
          check();
          return (await call(() => store.list())).filter(name => !names || names.has(name)).sort();
        },
        async has(name: string): Promise<boolean> { check(name); return (await call(() => store.get(name))) !== null; },
        async ref(name: string): Promise<SecretRef> {
          check(name);
          if ((await call(() => store.get(name))) === null) throw new Error("Secret key does not exist");
          return secretRef(name);
        },
        async get(name: string): Promise<string | null> {
          check(name);
          if (!options.allowReveal) throw new Error("Secret reveal is disabled; use ref() or ask the host to enable allowReveal");
          return call(() => store.get(name));
        },
        async set(name: string, value: string): Promise<SecretRef> {
          check(name);
          if (!options.allowWrite) throw new Error("Secret writes are disabled by the host");
          if (typeof value !== "string") throw new TypeError("A secret value must be a string");
          await call(() => store.set(name, value));
          return secretRef(name);
        },
        async remove(name: string): Promise<boolean> {
          check(name);
          if (!options.allowWrite) throw new Error("Secret writes are disabled by the host");
          return call(() => store.delete(name));
        },
      };
    },
  });
}

export default secret;
