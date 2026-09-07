# glove-env-base

Knowledge-base stdlib adapter for [`glove-working-environment`](../glove-working-environment). Mounts
pages, blocks and collections as `env:base` — pages read as markdown, rows as flat records, files
pulled into the tree.

**Bring your own backend.** Base owns the model and everything above it; a *provider* owns the
wire. Two methods are required and the rest are capabilities.

```bash
pnpm add glove-env-base
```

```ts
import { createWorkingEnvironment } from "glove-working-environment";
import { base } from "glove-env-base";
import { documents } from "glove-env-documents";

const env = await createWorkingEnvironment({
  stdlib: [base({ provider: myWiki }), documents()],
});
```

## Why it is a module and not a tool

A tool call puts the whole of a page in the context window. Two hundred rows of a tracker are
unreadable before they are useful, and the model has spent its budget before it has answered
anything.

From inside a script the page lands in a variable:

```js
import { collections } from 'env:base';
import { pdf } from 'env:documents';

export default async function main({ collectionId }) {
  const rows = await collections.query(collectionId, {
    where: [{ property: 'Status', op: 'isNot', value: 'Done' }],
  });

  const byOwner = Object.groupBy(rows, (r) => r.properties.Owner?.[0]?.name ?? 'unassigned');
  await pdf.create('/out/standup.pdf', {
    title: 'Open work',
    content: Object.entries(byOwner).flatMap(([owner, items]) => [
      { heading: owner, level: 2 },
      { bullets: items.map((i) => `${i.title} — due ${i.properties.Due?.start ?? 'no date'}`) },
    ]),
  });
  return `${rows.length} open items`;
}
```

Three hundred rows in, one PDF and one sentence out.

## The model

Four things, named once:

- **Rich text** — a run of text is an *array of spans*, not a string. A sentence can hold a bold
  link, a person, an inline formula and a date, and anything that walks content has to handle
  spans or silently lose half of it.
- **Block** — the atom of content, and a tree. Indentation is structure, not styling.
- **Page** — a block that is addressable and holds other blocks, plus a title and, when it belongs
  to a collection, typed properties.
- **Collection** — a set of pages sharing a schema. A row *is* a page, so every record has a
  document attached to it. "Page or row?" is usually a false question.

Two conventions hold throughout, both because the alternative loses data quietly. **Unknown is a
value, not an error**: block types and column types are open enums, and a type the model has never
heard of renders as a comment carrying its id rather than throwing. **`raw` is never dropped**:
whatever a provider could not express survives every round trip.

## What base does, so a provider does not

| | |
|---|---|
| **Markdown, both ways** | A block tree whose text is a span tree is the right wire format and an unusable one to reason over |
| **Tree walking** | Depth the caller sets, pagination per level, and an honest `truncated` when it stops early |
| **Schema-checked writes** | A bad column, a bad value, an option outside the set, a computed column — all fail before the network, naming the column |
| **The in-memory half of a query** | Whatever the backend could not filter or sort, applied here, so the answer is right against any backend |
| **Chunking** | A long body is split to whatever the backend accepts |
| **Export into the tree** | One markdown file per page, attachments pulled down, links rewritten |
| **Errors that name things** | `provider "wiki" getPage: …`, `provider "wiki" does not implement createPage()` |

## Writing a provider

```ts
import type { Provider } from "glove-env-base";

const wiki: Provider = {
  name: "wiki",

  async getPage(id) {
    const doc = await api.get(`/docs/${id}`);
    return { id: doc.id, title: doc.title, updatedAt: doc.modified };
  },

  async listBlocks(parentId, opts) {
    const page = await api.get(`/docs/${parentId}/nodes`, { cursor: opts?.cursor });
    return { blocks: page.nodes.map(toBlock), cursor: page.next };
  },
};
```

That is a working provider. Everything else — `getCollection`, `queryCollection`, `createPage`,
`updatePage`, `appendBlocks`, `updateBlock`, `deleteBlock`, `search`, `fetchFile`, `identify`,
`parseRef`, `request` — is optional, and base reports what is missing rather than crashing into
it. A read-only backend is a first-class one; `capabilities()` tells a script what it is holding.

Five rules, each held by a test:

1. **Return the model, not your wire format.** Whatever does not fit goes in `raw`.
2. **One level per `listBlocks` call.** Base does the recursion — it is the one that knows how deep
   the caller asked to go. Set `hasChildren` so it knows there is more.
3. **Paginate with `cursor`.** Never return a partial list without one.
4. **Push down what you can, declare what you cannot.** Anything you leave in `unsupported` base
   applies itself. Silent non-application returns wrong rows; declaring it returns right ones.
5. **Throw `ProviderError`** so failures carry your name.

### Checking it

```ts
import { verifyProvider, assertProviderOk } from "glove-env-base";

const report = await verifyProvider(wiki, { pageId: KNOWN_PAGE, collectionId: KNOWN_COLLECTION });
assertProviderOk(report);
report.warnings;   // advisory: a provider that recurses on base's behalf, a missing escape hatch
```

The static half needs nothing. Passing a real id turns on the shape checks that catch what a type
signature cannot — a `listBlocks` that recurses on your behalf, a schema with no title column, rows
that came back without flat properties.

### The HTTP toolkit, if your backend is a REST API

Optional; base never calls it. It exists because every provider otherwise rewrites the same bearer
header, timeout, `Retry-After`-honouring retry and cursor loop — and the cursor loop is the one
that is wrong in the way that returns a plausible answer computed from the first page.

```ts
import { createHttpClient } from "glove-env-base";

const http = createHttpClient({
  baseUrl: "https://api.example.com/v1",
  headers: () => ({ Authorization: `Bearer ${token()}` }),
  describeError: (status, body) =>
    status === 404 ? `${body.message} The integration may not have been given access.` : undefined,
});

const rows = await http.collect("POST", "/query", {
  items: (b) => b.results,
  next: (b) => b.next_cursor ?? undefined,
});
```

## Configuration

```ts
base({
  provider,                          // the only required option
  name: "wiki",                      // module name, if you mount two backends: env:wiki, env:crm
  depth: 4,                          // how deep pages.read walks by default
  appendChunk: 100,                  // blocks per appendBlocks call
  maxDownloadBytes: 50 * 1024 * 1024,
  maxExportPages: 100,
});
```

Mounting two backends at once is one adapter twice, not a second package:

```ts
stdlib: [base({ provider: wiki, name: "wiki" }), base({ provider: crm, name: "crm" })]
```

## The surface

| | |
|---|---|
| `describe(ref)` | Page or collection — and what to call next |
| `capabilities()` | What this backend actually implements |
| `search(query, opts?)` | Whatever the provider searches; read its docs |
| `download(url, path)` | A file into the tree, through the provider's own fetch |
| `request(method, path, body?)` | The escape hatch, where the provider offers one |
| `pages.get / read / create / update / append / export` | |
| `collections.get / query` | Schema, and rows as records |
| `blocks.children / append / update / remove` | Structure, when markdown is not enough |

`download` is not a general fetch. This environment has no network by construction, and base does
not invent one — the fetching is the provider's, restricted to whatever it decided to allow.

## Testing

No network, and no runtime dependencies. `tests/fake-provider.ts` is a provider in memory that
paginates, pushes down only some of a query, and can be built missing any capability, so the
"this backend cannot do that" paths are real rather than asserted about. The adapter is exercised
from inside scripts, through the realm bridge, which is the only place it is ever used.

```bash
pnpm --filter glove-env-base test
```
