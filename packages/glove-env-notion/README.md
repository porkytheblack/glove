# glove-env-notion

Notion stdlib adapter for [`glove-working-environment`](../glove-working-environment). Mounts a
workspace as `env:notion` — pages read as markdown, database rows as flat records, files pulled
into the tree.

```bash
pnpm add glove-env-notion
```

```ts
import { createWorkingEnvironment } from "glove-working-environment";
import { notion } from "glove-env-notion";
import { documents } from "glove-env-documents";

const env = await createWorkingEnvironment({
  stdlib: [notion({ token: process.env.NOTION_TOKEN! }), documents()],
});
```

## Why it is a module and not a tool

A tool call puts the whole of a page in the context window. Two hundred rows of a tracker are
unreadable before they are useful, and the model has spent its budget before it has answered
anything.

From inside a script the page lands in a variable:

```js
import { dataSources } from 'env:notion';
import { pdf } from 'env:documents';

export default async function main({ dataSourceId }) {
  const rows = await dataSources.query(dataSourceId, {
    filter: { property: 'Status', status: { does_not_equal: 'Done' } },
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

## The three decisions

**Pages read as markdown.** A block tree whose text is a span tree is the correct wire format and
an unusable one to reason over. `pages.read(id)` renders it. `blocks.children(id)` still returns
structure for code that needs it, and `{ raw: true }` returns the API's own objects for code that
needs everything.

**Rows read as plain values.** `row.properties.Status` is `'In progress'`, not
`{ type: 'status', status: { name: 'In progress', color: 'blue' } }`. All twenty-odd property
types flatten, including the ones with three levels of union in them — rollups reduce, formulas
resolve to their computed value, a `unique_id` is `'BUG-42'`. Writing goes back the other way
against the data source's schema, so `'2026-09-30'` reaches a date column as a date and a name
that is not a column fails here rather than as a 400 naming a JSON path.

**Databases and data sources are different objects**, because since API version `2025-09-03` they
are. A database is a *container*; a data source holds the schema and the rows. Every entry point
that can resolve one to the other does — a database with exactly one data source resolves
silently, and one with several refuses and names them rather than querying whichever was created
first. Both `parent.database_id` and `parent.data_source_id` are read, because both are in the
wild while the migration rolls out.

## The surface

| | |
|---|---|
| `describe(idOrUrl)` | What is this? Page, database, or data source — and what to call next |
| `search(query, opts?)` | Titles only, and only what the integration can see |
| `download(url, path)` | A Notion-hosted file into the tree. URLs are signed and expire |
| `request(method, path, body?)` | The escape hatch |
| `pages.get / read / create / update / append / export` | |
| `dataSources.get / query` | Schema, and rows as records |
| `databases.get / create` | The container, and the data sources in it |
| `blocks.children / append / update / remove` | Structure, when markdown is not enough |

Every one of them takes a bare id, a dashed id, or any `notion.so` URL — including the `?p=` form
Notion copies for a row peeked from a database view, where the id that matters is in the query
string rather than the path.

## Getting Notion into the tree

```js
const out = await pages.export(pageUrl, '/out/handbook.md', {
  recursive: true,   // one markdown file per child page
  assets: true,      // images and files pulled in, links rewritten to local paths
});
```

Those are ordinary paths, so the rest of the environment applies: `env:documents` turns them into
a PDF, `env:fs` greps them, `env:ocr` reads the scans that came down with them.

`download` reaches only the hosts Notion serves files from (`allowHosts` widens it). This is a
real boundary rather than a formality: the environment has no network by construction, and an
unrestricted `download(url, path)` would quietly hand one back.

## Configuration

```ts
notion({
  token: process.env.NOTION_TOKEN!,   // or a function, called per request, for a refreshing token
  notionVersion: "2025-09-03",        // the version this adapter's shapes match
  maxRetries: 3,                      // 429 honours Retry-After; 5xx and network failures back off
  maxPages: 50,                       // pagination cap — exceeding it throws rather than truncating
  depth: 4,                           // how deep pages.read walks by default
  allowHosts: [...],                  // what download() may fetch from
  maxDownloadBytes: 50 * 1024 * 1024,
  fetch,                              // injectable, which is how this package is tested offline
});
```

The token needs the capabilities for what you do with it (read content, update content, insert
content), and the integration must be **added to each page** — Notion's `object_not_found` is what
an unshared page looks like, so the adapter's error says so.

## The object model, in the errors

Most of what is hard about Notion is structural, and the adapter tries to say it where it comes
up rather than only in a README:

- A **row is a page**. It has a body, fetched separately by `pages.read(row.id)`.
- **There are no folders.** Sidebar structure is page nesting, which is why `pages.export` walks
  `child_page` blocks and nothing else.
- A **toggle heading** is `heading_n` with `is_toggleable`, not a type. A **simple table** is one
  `table` block with `table_row` children, unrelated to databases.
- A **synced block** mirrors an original; the children you read from a duplicate are the
  original's.
- **`unsupported` is a real return value.** The API models fewer block types than the product
  ships. Rendering emits an HTML comment carrying the block's id rather than failing, so one new
  block type never costs you the page.
- **A page id is a block id.** `blocks.children(pageId)` is how you read a page's content.

## Testing

The package has no runtime dependencies and no network in its tests: `fetch` is injected, and
`tests/fake.ts` is a Notion-shaped API in memory that paginates and fails the way the real one
does. The adapter itself is tested from inside scripts, through the realm bridge, which is the
only place it is ever used.

```bash
pnpm --filter glove-env-notion test
```
