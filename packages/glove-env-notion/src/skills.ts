/**
 * Worked recipes for env:notion, materialized under /skills.
 *
 * `/std/notion/index.d.ts` says what the module exports. These say how to get
 * a piece of work done with it — and, more usefully, they front-load the two
 * facts about Notion's object model that a signature cannot teach: rows live
 * on data sources rather than databases, and a row is a page with a body.
 */
import type { StdlibAdapter } from "glove-working-environment";

type Skill = NonNullable<StdlibAdapter["skills"]>[number];

const ORIENT: Skill = {
  name: "notion-orientation",
  summary: "Start from a pasted URL: what it is, and what to call next.",
  body: `# Finding your way in from a link

Someone gives you a Notion URL. It could be a page, a database, or a view of
a database. \`describe\` answers that in one call, and takes the URL as pasted.

\`\`\`js
import { describe } from 'env:notion';

export default async function main({ url }) {
  return describe(url);
}
\`\`\`

What comes back tells you where to go:

- \`object: 'page'\` → \`pages.read(id)\` for its content, \`pages.get(id)\` for
  just its properties.
- \`object: 'database'\` → it is a **container**. The reply carries
  \`dataSources: [{ id, name }]\`; query one of those.
- \`object: 'data_source'\` → the reply carries \`properties\`, the schema as
  name → type. This is the thing you query and write rows into.

That database/data-source split is the one piece of this API worth holding in
your head. Since version 2025-09-03 a database is a container of one or more
data sources, and every schema and row operation belongs to a data source.
Passing a database id where a data source belongs is the most common way to
get a \`validation_error\` out of Notion.

Do not have a link? \`search('quarterly review')\` matches **titles only** —
never page content — and sees only what the integration has been shared with.
An \`object_not_found\` on a real id means exactly that sharing is missing:
open the page in Notion → ••• → Connections.
`,
};

const ROWS: Skill = {
  name: "notion-database-rows",
  summary: "Query a database and reduce it in the script, not in the context window.",
  body: `# Rows as records

Every row comes back with plain values. No \`{ type: 'status', status: { name }}\`
walking, and no pagination loop — \`query\` exhausts it.

\`\`\`js
import { describe, dataSources } from 'env:notion';

export default async function main({ databaseUrl }) {
  const db = await describe(databaseUrl);
  const rows = await dataSources.query(db.dataSources[0].id);

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
Notion.** \`row.properties.Status\` is \`'In progress'\`; \`row.properties.Due\` is
\`{ start: '2026-09-14' }\`; \`row.properties.Owner\` is \`[{ id, name }]\`;
\`row.properties.Tags\` is \`['infra', 'urgent']\`; a relation is an array of page
ids. \`row.title\` is the title column, also available by its own name.

Filter server-side when you can — it is Notion's own filter object, unchanged:

\`\`\`js
const open = await dataSources.query(dataSourceId, {
  filter: { and: [
    { property: 'Status', status: { does_not_equal: 'Done' } },
    { property: 'Due', date: { on_or_before: '2026-09-30' } },
  ]},
  properties: ['Name', 'Status', 'Due'],   // drop the columns you will not read
});
\`\`\`

A row is a page, so its body is fetched separately and only when you want it:
\`pages.read(row.id)\`.
`,
};

const WRITE: Skill = {
  name: "notion-writing",
  summary: "Create and update pages and rows with plain values and markdown.",
  body: `# Writing back

Properties go in as ordinary JavaScript values and are coerced against the
data source's schema, so \`'In progress'\` reaches a status column as an option
and \`'2026-09-30'\` reaches a date column as a date.

\`\`\`js
import { pages } from 'env:notion';

export default async function main({ dataSourceId }) {
  const row = await pages.create(dataSourceId, {
    title: 'Ship the export path',
    properties: {
      Status: 'In progress',
      Due: '2026-09-30',
      Tags: ['infra', 'urgent'],
      Owner: ['user-id-here'],
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
  return row.url;
}
\`\`\`

Rules that save a round trip:

- **A column that does not exist fails here**, naming the columns that do —
  it does not reach the API.
- **Computed columns are refused**: formula, rollup, unique_id, created_time,
  created_by, last_edited_*, button, verification. Notion owns them and
  sending them fails the whole request.
- **Updating is the same shape**: \`pages.update(id, { properties: { Status: 'Done' } })\`.
  Only what you pass is changed.
- **Markdown converts** headings, the three list kinds, quotes, code fences,
  dividers and paragraphs, with inline bold, italic, strikethrough, code and
  links. Anything else, build as blocks and pass \`{ blocks: [...] }\` — the raw
  API payloads go through untouched.
- **Trashing is an update**: \`pages.update(id, { archived: true })\`.

To create a page rather than a row, give it a page as its parent:
\`pages.create({ pageId }, { title, markdown })\`.
`,
};

const FILES: Skill = {
  name: "notion-files-and-export",
  summary: "Pull a page and its attachments into the tree, for the other modules to read.",
  body: `# Getting Notion into the tree

Notion-hosted file URLs are **signed and expire**, usually within the hour. A
URL you read from a page is worth one fetch; storing one and using it later
does not work.

\`\`\`js
import { pages, download } from 'env:notion';
import { pdf } from 'env:documents';

export default async function main({ pageUrl }) {
  const page = await pages.read(pageUrl);
  const attachment = page.blocks.find((b) => b.type === 'pdf' || b.type === 'file');
  if (!attachment) return 'nothing attached';

  await download(attachment.url, '/inbox/spec.pdf');
  const { text } = await pdf.extractText('/inbox/spec.pdf');
  return text.slice(0, 500);
}
\`\`\`

For a whole subtree, \`export\` does the walking:

\`\`\`js
const out = await pages.export(pageUrl, '/out/handbook.md', {
  recursive: true,   // one markdown file per child page
  assets: true,      // images and files pulled in, links rewritten to local paths
});
out.files            // every path written
\`\`\`

Those are ordinary paths, so everything else in the environment applies:
\`env:documents\` turns them into a PDF, \`env:fs\` greps them, \`env:images\`
resizes what came down with them.

\`download\` reaches only the hosts Notion serves files from. It is not a
general fetch — this environment has no network of its own, and that is on
purpose.
`,
};

const EDGES: Skill = {
  name: "notion-structure",
  summary: "Blocks, nesting, and what to do when the API has no model for something.",
  body: `# When markdown is not enough

\`pages.read\` renders content as markdown because that is the readable form.
When you need structure — checking off to-dos, walking a table, editing one
block — go to the blocks.

\`\`\`js
import { blocks } from 'env:notion';

export default async function main({ pageId }) {
  const tree = await blocks.children(pageId, { depth: 3 });

  let done = 0;
  const walk = (list) => {
    for (const b of list) {
      if (b.type === 'to_do' && !b.checked) { done++; }
      if (b.children) walk(b.children);
    }
  };
  walk(tree);
  return \`\${done} unchecked\`;
}
\`\`\`

Things about the block model that catch people out:

- **A page id is a block id.** \`blocks.children(pageId)\` is how you read a
  page's content; there is no separate endpoint.
- **Nesting is real structure**, not indentation. Anything with
  \`hasChildren\` has a subtree, and \`depth\` controls how far the walk goes
  (\`truncated\` on a \`pages.read\` says it stopped early).
- **A toggle heading is not a type.** It is \`heading_1\` with
  \`toggleable: true\`. Simple tables are one \`table\` block with \`table_row\`
  children, and have nothing to do with databases.
- **A synced block mirrors its original.** The children you read from a
  duplicate are the original's.
- **\`unsupported\` is a real type.** The API models fewer block types than the
  product ships, and rendering emits an HTML comment carrying the id rather
  than failing. Nothing that walks Notion content should throw on a type it
  does not know.

For anything with no binding, go straight at the API:

\`\`\`js
import { request } from 'env:notion';
await request('PATCH', \`/blocks/\${id}\`, { to_do: { checked: true } });
\`\`\`
`,
};

export const NOTION_SKILLS: Skill[] = [ORIENT, ROWS, WRITE, FILES, EDGES];
