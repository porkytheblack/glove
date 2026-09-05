---
"glove-env-base": minor
---

Add `glove-env-base` — pages, blocks and collections as `env:base`, so an agent can read and write a knowledge base from inside a script instead of through tool calls that put every page in the context window.

The package is the half of that which does not depend on whose backend it is. A **provider** — yours to write — owns the wire; base owns the model and everything above it.

- **The object model, named once.** Rich text is an array of spans, not a string. A block is the atom of content and a tree, so indentation is structure. A page is a block that is addressable and holds blocks. A collection is a set of pages sharing a schema — and a row *is* a page, with a body as well as columns. Block types and column types are open enums: a type the model has never heard of renders as a comment carrying its id rather than throwing, and whatever a provider could not express survives in `raw`.
- **Pages read as markdown**, both directions, with nesting, annotations, links, inline equations and tables. `blocks.children` still returns structure, `{ raw: true }` returns the spans, and `truncated` says when a walk stopped at `depth` rather than letting a partial tree read as a whole one.
- **Rows read as plain values.** `row.properties.Status` is `'In progress'`. Writing goes back the other way against the collection's schema: a column that does not exist fails naming the ones that do, a select option outside the defined set fails listing them, a value of the wrong shape fails naming the column, and a computed column is refused with the reason. None of those reach the network.
- **Queries are structural and portable.** Whatever the backend cannot filter or sort itself comes back in `unsupported` and base finishes it over the rows — so the answer is right against a backend that pushes down everything and one that pushes down nothing. Pagination is exhausted rather than exposed, and running past the cap throws instead of returning a prefix.
- **Capabilities are genuinely optional.** `getPage` and `listBlocks` are the floor; everything else is reported by `capabilities()` and named on use — `provider "wiki" does not implement createPage()`, not `undefined is not a function`. A read-only backend is a first-class one.
- **`pages.export(id, path, { recursive, assets })`** writes a page and its subtree into the tree as markdown with attachments pulled down and links rewritten, which is what makes a page reachable by `env:documents`, `env:images` and `env:ocr`. `download` fetches through the provider: this environment has no network by construction and base does not invent one.
- **Writing a provider is supported work**, not an exercise: `verifyProvider()` checks an implementation against the contract (including the mistakes a type signature cannot catch — a `listBlocks` that recurses on base's behalf, a schema with no title column), and an optional `createHttpClient()` covers the bearer header, timeout, `Retry-After`-honouring retry and cursor loop that every REST-backed provider would otherwise rewrite.
- **Two backends mount side by side** — `base({ provider, name: "wiki" })` and `base({ provider, name: "crm" })` — one adapter twice rather than a second package.

Zero runtime dependencies, and no network in its tests: the suite runs against a provider held in memory that paginates, pushes down only part of a query, and can be built missing any capability.
