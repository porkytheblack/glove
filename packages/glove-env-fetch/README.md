# glove-env-fetch

HTTP requests, downloads and uploads for `glove-working-environment`.
Scripts import `request`, `download` and `upload` from `env:fetch`. Bodies
come from strings, JSON, forms, multipart fields/files or VFS bytes; response bodies land in the VFS.

```ts
import { createWorkingEnvironment } from 'glove-working-environment';
import { fetchFiles } from 'glove-env-fetch';
import { secret, secretRef, createMemorySecretStore } from 'glove-env-secret';

const store = createMemorySecretStore({ 'bank/token': tokenFromHost });
const env = await createWorkingEnvironment({
  stdlib: [
    secret({ store }),
    fetchFiles({
      allowedDomains: ['api.example.com', '*.files.example.com'],
      blockedDomains: ['private.files.example.com'],
      secretStore: store,
      credentials: {
        bank: {
          origins: ['https://api.example.com'],
          headers: { Authorization: { ref: secretRef('bank/token'), prefix: 'Bearer ' } },
        },
      },
    }),
  ],
});
```

Inside an environment script:

```ts
import { request, download, upload } from 'env:fetch';
import { readFile } from 'env:fs';

export default async function main() {
  const result = await request('https://api.example.com/statements/search', {
    method: 'POST',
    json: { month: '2026-09' },
    credential: 'bank',
    output: '/tmp/search.json',
  });
  if (!result.ok) return { status: result.status, path: result.path };
  return JSON.parse(await readFile(result.path));
}
```

`download(url, output, options?)` sends GET. `upload(input, url, options?)`
sends VFS file bytes with PUT by default; override `method` for POST/PATCH.
`request(url, options?)` supports HTTP methods, headers, and exactly one of
`body` (UTF-8 string), `json`, `bodyPath`, `form` (URL-encoded string fields or
arrays for repeated fields), or `multipart` (named values and VFS files). Multipart
boundaries and Content-Type are generated automatically. For example:

```ts
await request(url, {
  method: 'POST',
  multipart: [
    { name: 'description', value: 'September statement' },
    { name: 'file', path: '/inbox/statement.pdf', contentType: 'application/pdf' },
  ],
});
```

Raw multipart payloads can also be supplied as `bodyPath` with a matching
Content-Type header. Custom HTTP method names retain their case; the transport
does not support CONNECT, TRACE or TRACK. This is not a shell/curl-command
interpreter, browser session, cookie jar, or support for non-HTTP protocols.

Every result is `{ path, status, ok, bytes, contentType, headers }`. Missing
`output` creates a unique `/tmp/fetch/*.bin`. `request` saves non-2xx response
bodies unless `throwOnHttpError` is true; download/upload always throw on HTTP
failure. Existing output files require `overwrite: true`. The response body
is streamed into bounded memory and committed through the guarded VFS only
after successful consumption. No partial file is written on HTTP/read failures.

## Host network policy

| Option | Behavior |
| --- | --- |
| `allowedDomains` | Exact hostnames or `*.example.com` for subdomains only. Omitted allows all; `[]` denies all. |
| `blockedDomains` | Same pattern syntax; takes precedence over allow rules. |
| `allowedOrigins` | Additional exact scheme/host/port restrictions. |
| `authorize(url, method)` | Additional async host policy; false or rejection denies the request. |
| `fetch` | Inject a proxy-aware or IP/DNS-filtering transport; must honor `redirect: 'manual'` and the abort signal. |

Per-call `redirect` can be `follow` (default), `manual` (save and return the
redirect response), or `error`. Use `request` for manual redirects because
`download` and `upload` require 2xx status. All redirect targets are rechecked. Hostnames are normalized for case,
international domain names and trailing dots. Cross-origin redirects drop
all request headers. A request body is never replayed to another origin;
303 and POST 301/302 redirects become GET before following.

Mounting this adapter grants HTTP(S) access. Domain policy checks URL names,
not DNS results or IP ranges; deployments needing private-address/DNS-rebinding
protection should enforce it in their network/proxy or injected transport.
No process-wide fetch changes are made.

Credential aliases are host-defined and restricted to exact origins. Secret
references are resolved on each initial request, so rotated tokens take effect
without recreating the adapter. Credentials are not returned by the adapter;
the authorized remote service can still return sensitive data in its response.
The default response header selection excludes Set-Cookie. Set `responseHeaders`
to an explicit list to expose other headers such as `link`, `etag` or cookies.

Defaults: 30-second deadline, 32 MiB request/response caps, five redirects.
Configure `timeoutMs`, `maxUploadBytes`, `maxResponseBytes` and `maxRedirects`;
VFS file limits also apply. Response limits count decoded bytes, including gzip
expansion; multipart limits include encoding overhead. `bytes` may differ from
the server's Content-Length. Uploads and responses use bounded memory.

The deadline covers policy callbacks, credential resolution, transport and
response reading. Per-call `timeoutMs` may shorten it, but cannot extend the
host limit. A host `signal` cancels outstanding requests, including when an
injected transport ignores abort. Late results cannot write files. Filesystem
commits are awaited once started, so their latency is outside the HTTP deadline.
Already-sent requests cannot be undone by cancelling an environment script.
HTTP is unavailable during script validation. There are no automatic retries;
callers decide whether a failed operation is safe to repeat.

Do not embed sensitive tokens in script source, URLs or run arguments, which
can be recorded in history. Prefer host-provisioned credential aliases. Response
files have the same persistence and history retention as other VFS content.
