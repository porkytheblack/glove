/**
 * Worked recipes for env:base, materialized under /skills.
 *
 * `/std/base/index.d.ts` says what the module exports. These say how to get a
 * piece of work done with it, and front-load the three things a signature
 * cannot teach: values live under `.properties`, a row is a page with a body,
 * and the backend may not implement everything.
 */
import type { StdlibAdapter } from "glove-working-environment";

type Skill = NonNullable<StdlibAdapter["skills"]>[number];

const ORIENT: Skill = {
  name: "base-orientation",
  summary: "Start from a pasted link or id: what it is, what to call next, and what this backend can do.",
  body: `# Finding your way in

Someone gives you an id or a URL. \`describe\` says what it is, in one call,
and takes it however it was written.

\`\`\`js
import { describe, capabilities } from 'env:base';

export default async function main({ ref }) {
  return { what: await describe(ref), can: await capabilities() };
}
\`\`\`

Where to go from what comes back:

- \`kind: 'page'\` → \`pages.read(id)\` for its content as markdown,
  \`pages.get(id)\` when you only want the properties.
- \`kind: 'collection'\` → the reply carries \`schema\` (column name → type) and
  \`computed\` (the columns the backend owns and refuses writes to). Query it
  with \`collections.query\`.

**Check \`capabilities()\` before you plan a write.** This module is one half of
a pair: base owns the model, and a *provider* the host mounted owns the
backend. Optional capabilities are genuinely optional — a read-only backend is
a normal backend, not a broken one. Calling something unimplemented says
\`provider "x" does not implement createPage()\` rather than failing as
\`undefined is not a function\`, but knowing first saves the round trip.

Three structural facts worth holding, because they change what you write:

1. **A row is a page.** It has columns *and* a body. \`collections.query\` gives
   you the columns; \`pages.read(row.id)\` gives you the body, and only when you
   ask for it.
2. **A page id is a block id.** \`blocks.children(pageId)\` is how a body is
   read; there is no separate call.
3. **Nesting is structure.** Anything with \`hasChildren\` has a subtree, and
   \`depth\` decides how far the walk goes. A result with \`truncated: true\`
   stopped early — raise \`depth\` rather than assuming you saw it all.
`,
};

const ROWS: Skill = {
  name: "base-collections",
  summary: "Query a collection and reduce it in the script, not in the context window.",
  body: `# Rows as records

Every row comes back with plain values, and every page of them is fetched.

\`\`\`js
import { collections } from 'env:base';

export default async function main({ collectionId }) {
  const rows = await collections.query(collectionId, {
    where: [{ property: 'Status', op: 'isNot', value: 'Done' }],
    sort: [{ property: 'Due', direction: 'asc' }],
  });

  const byOwner = {};
  for (const row of rows) {
    for (const owner of row.properties.Owner ?? []) {
      (byOwner[owner.name] ??= []).push(row.title);
    }
  }
  return byOwner;   // three hundred rows in, one object out
}
\`\`\`

**Values are under \`.properties\`, keyed by the column's name as it appears in
the tool.** \`row.properties.Status\` is \`'In progress'\`; \`row.properties.Due\` is
\`{ start: '2026-09-14' }\`; \`row.properties.Owner\` is \`[{ id, name }]\`;
\`row.properties.Tags\` is \`['infra', 'urgent']\`; a relation is an array of page
ids. \`row.title\` is the title column, also reachable by its own name.

Filters are structural and portable:

\`\`\`js
where: [
  { property: 'Status', op: 'isNot', value: 'Done' },
  { property: 'Due', op: 'lte', value: '2026-09-30' },
  { property: 'Tags', op: 'contains', value: 'infra' },
]
\`\`\`

Ops: \`is\`, \`isNot\`, \`contains\`, \`notContains\`, \`startsWith\`, \`endsWith\`,
\`gt\`, \`gte\`, \`lt\`, \`lte\`, \`isEmpty\`, \`isNotEmpty\`. \`match: 'or'\` switches
the combination. Whatever the backend can push down it does; the rest runs
here over the rows — so the answer is right regardless of how capable it is.

Two habits that pay for themselves: \`properties: ['Name', 'Status']\` drops the
columns you will not read, and \`limit\` stops early when you only need a few.

A row's body is a separate, deliberate call: \`pages.read(row.id)\`.
`,
};

const WRITE: Skill = {
  name: "base-writing",
  summary: "Create and update pages and rows with plain values and markdown.",
  body: `# Writing back

Properties go in as ordinary JavaScript values and are checked against the
collection's schema *before* anything leaves the script.

\`\`\`js
import { pages } from 'env:base';

export default async function main({ collectionId }) {
  const row = await pages.create(collectionId, {
    title: 'Ship the export path',
    properties: {
      Status: 'In progress',
      Due: '2026-09-30',
      Tags: ['infra', 'urgent'],
      Estimate: 3,
    },
    markdown: [
      '## Context',
      '',
      'The old exporter dropped attachments.',
      '',
      '- [ ] port the fix',
      '- [ ] backfill last week',
    ].join('\\n'),
  });
  return row.url ?? row.id;
}
\`\`\`

What fails here rather than downstream, with the column named:

- a column that does not exist — the error lists the ones that do;
- a value the column cannot hold (\`'three'\` in a number column);
- a select or status option outside the defined set — the error lists them;
- a **computed** column: formula, rollup, uniqueId, createdAt, createdBy,
  updatedAt, updatedBy, verification, button. The backend owns those, and
  sending one usually fails the whole request, taking the nine good columns
  with it.

Other things worth knowing:

- **Updating is the same shape**, and changes only what you pass:
  \`pages.update(id, { properties: { Status: 'Done' } })\`.
- **Trashing is an update**: \`pages.update(id, { archived: true })\`.
- **Markdown converts** headings, the three list kinds, quotes, code fences,
  dividers and paragraphs, with inline bold, italic, strikethrough, code and
  links. Nesting by indentation works. Anything richer, build as blocks and
  pass \`{ blocks: [...] }\` — they go through untouched.
- **A long body is not your problem.** Base splits it into whatever chunk size
  the backend accepts.
- To create a page rather than a row: \`pages.create({ pageId }, { title, markdown })\`.
  A page outside a collection has no columns, only a title, and asking for
  properties there says so.
`,
};

const FILES: Skill = {
  name: "base-files-and-export",
  summary: "Pull a page and its attachments into the tree, for the other modules to read.",
  body: `# Getting content into the tree

Hosted file URLs are usually **signed and short-lived**. A URL read from a
page is worth one fetch; storing one and using it later does not work.

\`\`\`js
import { pages, download, capabilities } from 'env:base';
import { pdf } from 'env:documents';

export default async function main({ pageId }) {
  if (!(await capabilities()).files) return 'this backend does not serve files';

  const page = await pages.read(pageId);
  const attachment = page.blocks.find((b) => b.type === 'file' || b.type === 'image');
  if (!attachment) return 'nothing attached';

  await download(attachment.url, '/inbox/spec.pdf');
  const { text } = await pdf.extractText('/inbox/spec.pdf');
  return text.slice(0, 500);
}
\`\`\`

For a whole subtree, \`export\` does the walking:

\`\`\`js
const out = await pages.export(pageId, '/out/handbook.md', {
  recursive: true,   // one markdown file per child page
  assets: true,      // files pulled in, links rewritten to local paths
});
out.files            // every path written
\`\`\`

Those are ordinary paths, so everything else in the environment applies:
\`env:documents\` turns them into a PDF, \`env:fs\` greps them, \`env:ocr\` reads
the scans that came down with them.

\`download\` is not a general fetch. This environment has no network of its own,
and base does not invent one — the fetching is the provider's, restricted to
whatever it decided to allow. A backend whose provider has no \`fetchFile\` has
no \`download\`, and says so.
`,
};

const STRUCTURE: Skill = {
  name: "base-structure",
  summary: "Blocks, nesting, and what to do when the model has no name for something.",
  body: `# When markdown is not enough

\`pages.read\` renders content as markdown because that is the readable form.
When you need structure — checking off to-dos, walking a table, editing one
block — go to the blocks.

\`\`\`js
import { blocks } from 'env:base';

export default async function main({ pageId }) {
  const tree = await blocks.children(pageId, { depth: 3 });

  let open = 0;
  const walk = (list) => {
    for (const b of list) {
      if (b.type === 'to_do' && b.checked === false) open++;
      if (b.children) walk(b.children);
    }
  };
  walk(tree);
  return \`\${open} unchecked\`;
}
\`\`\`

\`blocks.children\` gives you text already flattened to strings. Pass
\`{ raw: true }\` when you need the spans — the annotations, the links, the
mentions — rather than the words alone.

The block shapes worth recognizing:

- \`heading\` carries \`level\` (1–3) and \`collapsible\`. A toggle heading is a
  heading with a flag, not a type of its own.
- \`table\` holds \`table_row\` children whose \`cells\` are per-cell text; it has
  nothing to do with a collection.
- \`columns\` / \`column\` / \`synced\` are containers — read their children. A
  synced block's children are the original's.
- \`child_page\` is a nested page; its id is the page's id, which is how
  \`export({ recursive: true })\` walks a subtree.
- \`unsupported\`, or any type you do not recognize, is **normal**. The model is
  open, backends ship faster than models of them, and rendering emits a
  comment carrying the id rather than failing. Never throw on an unknown
  block type.

For anything with no binding, and where the backend offers one:

\`\`\`js
import { request, capabilities } from 'env:base';
if ((await capabilities()).request) {
  await request('PATCH', \`/blocks/\${id}\`, { checked: true });
}
\`\`\`
`,
};

export const BASE_SKILLS: Skill[] = [ORIENT, ROWS, WRITE, FILES, STRUCTURE];
