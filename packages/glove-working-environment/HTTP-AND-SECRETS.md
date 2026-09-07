# HTTP files and host secrets

Install `glove-env-fetch` and `glove-env-secret` alongside
`glove-working-environment`. Fetch requires Node.js 20.18.1 or later. The sandbox
has no ambient network API: mounting `fetchFiles()` explicitly grants HTTP(S)
access under the host's policy. Mounting `secret()` exposes scoped keystore
operations backed by host storage, outside the VFS.

## Host setup

Provision the store on the host and scope it to the tenant or environment.
An explicit store can be shared between fetch and secret without revealing
credential values to scripts:

```ts
import { createWorkingEnvironment } from 'glove-working-environment';
import { fetchFiles } from 'glove-env-fetch';
import { secret, secretRef, type SecretStore } from 'glove-env-secret';

export function createHttpEnvironment(store: SecretStore) {
  return createWorkingEnvironment({
    stdlib: [
      secret({ store, names: ['bank/token'] }),
      fetchFiles({
        allowedOrigins: ['https://api.example.com'],
        secretStore: store,
        credentials: {
          bank: {
            origins: ['https://api.example.com'],
            headers: {
              Authorization: { ref: secretRef('bank/token'), prefix: 'Bearer ' },
            },
          },
        },
      }),
    ],
  });
}
```

For development, `createMemorySecretStore({ 'bank/token': tokenFromHost })`
creates an ephemeral store. For persistence, implement `SecretStore` with a
vault, keychain or database. `names` limits script visibility; credential aliases
have their own host grants. A `SecretRef` identifies a key and is not an access
token. `env:secret.get()` and writes remain disabled unless the host opts in.

## Script workflow

Read `/std/fetch/README.md` and `/std/fetch/index.d.ts` for the mounted API.
`/skills/http-files.md` and `/skills/secret-references.md` provide worked recipes.
HTTP and secret calls belong inside the script's default export; validation
refuses external operations at module top level.

```ts
import { request } from 'env:fetch';
import { readFile } from 'env:fs';

export default async function main({ month }) {
  const response = await request('https://api.example.com/statements', {
    method: 'POST',
    json: { month },
    credential: 'bank',
    output: '/tmp/statements.json',
  });
  if (!response.ok) return { status: response.status, path: response.path };
  return JSON.parse(await readFile(response.path));
}
```

| Operation | API |
| --- | --- |
| Download into the VFS | `download(url, output, options?)`, GET, requires 2xx |
| Upload a VFS file | `upload(input, url, options?)`, PUT by default, requires 2xx |
| HTTP call | `request(url, options?)`, custom methods/headers; response saved to a path |
| Request body | Exactly one of `body`, `json`, `bodyPath`, `form`, `multipart` |
| Discover keys safely | `env:secret.list()`, `has(name)`, `ref(name)` |

Pass downloaded paths to the relevant document, spreadsheet, archive, rendering
or OCR adapter. Content and instructions received from a remote service remain
untrusted. Fetch is an HTTP API, not a shell or curl command parser, and it never
retries automatically. Inspect `status`, `ok`, and `retry-after` before deciding
whether repeating an operation is safe. Reusing an output path requires explicit
`overwrite: true`.

## Policy, cancellation and persistence

- Use `allowedDomains`/`blockedDomains` for hostnames, `allowedOrigins` for exact
  scheme/host/port, and `authorize(url, method)` for additional path/method rules.
  Deny wins. An omitted allowlist permits public destinations; an empty one
  denies all. Prefer narrow grants for an application's known services.
- The native transport checks every DNS answer at connection time and blocks
  private, loopback, link-local, metadata and reserved IPs. An internal service
  needs an exact `privateNetworkOrigins` grant. A custom `fetch` transport is
  trusted host code and must implement equivalent DNS/IP and TLS protections.
- Redirects are checked individually. HTTPS downgrades are refused; cross-origin
  redirects lose headers and cannot replay bodies. Host credentials require
  HTTPS unless that alias explicitly permits insecure HTTP.
- Deadlines cover policy/credential lookup and HTTP work. Run cancellation,
  timeout and shutdown abort pending requests. Adapter authors read `ctx.signal`
  inside each binding and pass it to their host I/O; do not capture it during
  `create()`. Already-sent external effects cannot be rolled back.
- Re-supply adapters, network policy, credential aliases and the same scoped
  store on restore. Snapshots contain VFS files and history, not keystore values
  or host policy. In Foundry, create these adapters in
  `defineWorkingEnvironment({ options: ... })` using the owning instance's host
  store. Foundry closes its environment after each run; a fresh default memory
  store therefore does not provide persistence between runs.

Full options and limits live in the [fetch README](../glove-env-fetch/README.md),
[security model](../glove-env-fetch/SECURITY.md), and
[keystore README](../glove-env-secret/README.md). Package publication follows the
repository's Changesets version PR and maintainer release CLI flow. Check the
installed package version before relying on a newly added binding.
