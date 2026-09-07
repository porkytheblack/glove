# glove-env-secret

A host-backed keystore for `glove-working-environment`, exposed as `env:secret`.
Values live in the host store, outside VFS snapshots and filesystem tools.
Mounting the adapter installs `/skills/secret-references.md` in the environment.
For fetch integration and restore behavior, see the [HTTP and secrets guide](../glove-working-environment/HTTP-AND-SECRETS.md).

```ts
import { createWorkingEnvironment } from 'glove-working-environment';
import { secret, createMemorySecretStore } from 'glove-env-secret';

const store = createMemorySecretStore({ 'bank/password': passwordFromHost });
const env = await createWorkingEnvironment({
  stdlib: [secret({ store, names: ['bank/password'] })],
});
```

```ts
// Environment script
import { list, has, ref } from 'env:secret';

export default async function main() {
  return { keys: await list(), bank: await ref('bank/password') };
  // bank is { kind: 'env:secret', name: 'bank/password' }, not the password.
}
```

| Script API | Behavior |
| --- | --- |
| `list()` | Names only, filtered by the host's optional `names` scope. |
| `has(name)` | Whether the key exists; empty string values count as present. |
| `ref(name)` | Reference to an existing key; no value is returned. |
| `get(name)` | Plaintext value or null; requires `allowReveal: true`. |
| `set(name, value)` | Create or replace a string value; requires `allowWrite: true`. Returns a reference. |
| `remove(name)` | Delete a key, returning whether it existed; requires `allowWrite: true`. |

Reveal and writes are disabled by default. Names must be 1–200 characters,
start with a letter/digit, and contain only letters, digits, `.`, `_`, `/`, `-`.
All calls run inside the script's default export, never during validation.
Backend errors are sanitized before returning to scripts.

## Storage and persistence

Omitting `store` creates fresh in-memory storage for each environment, even
when an adapter definition is reused. `createMemorySecretStore(initial?)`
returns an explicit store the host can provision and share between adapters.
It retains values only while referenced by the host; it is not encrypted
storage and does not survive a process restart. `env.close()` does not delete
an explicitly supplied store, which may still be used elsewhere.

For persistence, implement `SecretStore` using a vault, database or OS keychain:

```ts
interface SecretStore {
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<boolean>;
  list(): Promise<string[]>;
}
```

Scope each store to its owning tenant/environment. Sharing an explicit store
is deliberate sharing; `names` limits script access but is not provider-side
tenant isolation. The host controls storage encryption, authentication and
backup policy. VFS snapshots do not back up keystore values.

References identify keys; they are not bearer credentials or authorization.
Consuming adapters need their own host grants. `glove-env-fetch` can use the
same store and host-configured credential aliases without revealing tokens
to scripts. A host can also read a document password from the store and pass
it directly to a document-unlocking operation.

Secret names can appear in script results and history, so use descriptive
names rather than sensitive values. Opting into `get`, embedding a value in
saved source, or passing it as a script argument can expose that value through
normal history/output recording. Provision sensitive values on the host and
use references or configured operations where possible.
