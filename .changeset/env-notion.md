---
"glove-env-notion": minor
---

Add `glove-env-notion` — a Notion workspace as `env:notion`, so an agent can read and write one from inside a script instead of through tool calls that put every page in the context window.

- **Pages read as markdown.** A block tree whose text is a span tree is the right wire format and an unusable one to reason over. `pages.read` renders it — annotations, links, inline equations, nesting, simple tables and all. `blocks.children` still returns structure, and `{ raw: true }` returns the API's own objects.
- **Rows read as plain values.** `row.properties.Status` is `'In progress'`. Every property type flattens, including the ones with three levels of union in them: rollups reduce, formulas resolve, a `unique_id` is `'BUG-42'`, an expiring file carries its `expires`. Writing goes back the other way against the data source's schema, so `'2026-09-30'` reaches a date column as a date, a column that does not exist fails naming the ones that do, and a computed column is refused with the reason rather than as a 400.
- **Databases and data sources are separate objects**, as API version `2025-09-03` has them. A database with exactly one data source resolves silently; one with several refuses and names them rather than querying whichever was created first. Both `parent.database_id` and `parent.data_source_id` are read, because both are in the wild while the migration rolls out.
- **`pages.export(id, path, { recursive, assets })`** writes a page and its subtree into the tree as markdown, pulling attachments down and rewriting the links — which is what makes a Notion page reachable by `env:documents`, `env:images` and `env:ocr`.
- **`unsupported` never costs you the page.** Unknown block types render as an HTML comment carrying the block id, and `request()` is the documented way through for anything the bindings do not cover.
- Pagination is exhausted rather than exposed, and running past the page cap throws instead of returning a prefix that reads as a whole answer. 429 honours `Retry-After`; 5xx and network failures back off; 4xx does not retry. `object_not_found` explains that an integration sees only what has been shared with it.
- `download` reaches only the hosts Notion serves files from. The environment has no network by construction, and an unrestricted download would quietly hand one back.

Zero runtime dependencies, and no network in its tests: `fetch` is injected and the suite runs against a Notion-shaped fake that paginates and fails the way the real API does.
