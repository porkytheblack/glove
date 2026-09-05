import assert from "node:assert/strict";
import test from "node:test";
import { flatten, fromMarkdown, inline, toMarkdown } from "../src/markdown";
import { plainText, type Block } from "../src/model";

const t = (value: string) => [{ text: value }];

test("a span array renders with its annotations, not without them", () => {
  const md = toMarkdown([
    {
      type: "paragraph",
      text: [
        { text: "See " },
        { text: "the spec", href: "https://example.com" },
        { text: " — " },
        { text: "urgent", annotations: { bold: true } },
        { text: " and " },
        { text: "gone", annotations: { strikethrough: true } },
        { text: "e^{iπ}", equation: "e^{i\\pi}" },
      ],
    },
  ]);
  assert.equal(md, "See [the spec](https://example.com) — **urgent** and ~~gone~~$e^{i\\pi}$");
});

test("code wraps innermost so the other markers survive it", () => {
  assert.equal(
    toMarkdown([{ type: "paragraph", text: [{ text: "x", annotations: { code: true, bold: true } }] }]),
    "**`x`**",
  );
});

test("a heading is one type with a level, and so is a toggle heading", () => {
  const md = toMarkdown([
    { type: "heading", level: 1, text: t("One") },
    { type: "heading", level: 3, text: t("Three"), collapsible: true },
  ]);
  assert.equal(md, "# One\n\n### Three");
});

test("nesting is structure, and indentation follows it", () => {
  const tree: Block[] = [
    {
      type: "bulleted_list_item",
      text: t("Parent"),
      children: [
        { type: "bulleted_list_item", text: t("Child"), children: [{ type: "to_do", text: t("Deep"), checked: true }] },
      ],
    },
  ];
  assert.equal(toMarkdown(tree), "- Parent\n  - Child\n    - [x] Deep");
});

test("a numbered list counts its own siblings, and a switch of kind gets a blank line", () => {
  const md = toMarkdown([
    { type: "numbered_list_item", text: t("One") },
    { type: "numbered_list_item", text: t("Two") },
    { type: "paragraph", text: t("Break") },
    { type: "numbered_list_item", text: t("One again") },
  ]);
  assert.equal(md, "1. One\n2. Two\n\nBreak\n\n1. One again");
});

test("a table renders as a table, header honoured", () => {
  const md = toMarkdown([
    {
      type: "table",
      columns: 2,
      hasHeader: true,
      children: [
        { type: "table_row", cells: [t("Region"), t("Revenue")] },
        { type: "table_row", cells: [t("EMEA"), t("2.4M")] },
      ],
    },
  ]);
  assert.equal(md, "| Region | Revenue |\n| --- | --- |\n| EMEA | 2.4M |");
});

test("a type the model has never heard of is a comment, never a thrown error", () => {
  // Backends ship faster than models of them. A page must still render.
  const md = toMarkdown([
    { id: "x", type: "unsupported" },
    { id: "y", type: "sticker_wall", text: t("hi") },
    { type: "paragraph", text: t("after") },
  ]);
  assert.match(md, /<!-- unsupported block x/);
  assert.match(md, /<!-- sticker_wall block y: hi -->/);
  assert.match(md, /after/);
});

test("containers render their contents, not themselves", () => {
  const md = toMarkdown([
    {
      type: "columns",
      children: [
        { type: "column", children: [{ type: "paragraph", text: t("Left") }] },
        { type: "column", children: [{ type: "paragraph", text: t("Right") }] },
      ],
    },
    { type: "synced", syncedFrom: "orig", children: [{ type: "paragraph", text: t("Mirrored") }] },
  ]);
  assert.equal(md, "Left\n\nRight\n\nMirrored");
});

test("a code block keeps its language and survives a fence in its body", () => {
  assert.equal(
    toMarkdown([{ type: "code", language: "javascript", text: t("a\n```\nb") }]),
    "````javascript\na\n```\nb\n````",
  );
});

test("markdown converts to blocks", () => {
  const blocks = fromMarkdown(
    ["# Title", "", "Some **bold** text.", "", "- one", "  - nested", "- [ ] todo", "", "1. first", "", "> quoted", "", "---", "", "```js", "const x = 1;", "```"].join("\n"),
  );
  assert.deepEqual(
    blocks.map((b) => b.type),
    ["heading", "paragraph", "bulleted_list_item", "to_do", "numbered_list_item", "quote", "divider", "code"],
  );
  assert.equal(blocks[0].level, 1);
  assert.equal(blocks[2].children?.length, 1);
  assert.equal(blocks[2].children?.[0].type, "bulleted_list_item");
  assert.equal(blocks[7].language, "js");
  assert.equal(plainText(blocks[7].text), "const x = 1;");
});

test("an empty children array is dropped — it would claim a subtree that is not there", () => {
  assert.equal("children" in fromMarkdown("- alone")[0], false);
});

test("inline markdown becomes annotated spans", () => {
  const spans = inline("a **b** and `c` and [d](https://e.com) and ~~f~~");
  assert.equal(plainText(spans), "a b and c and d and f");
  assert.deepEqual(spans[1].annotations, { bold: true });
  assert.deepEqual(spans[3].annotations, { code: true });
  assert.equal(spans[5].href, "https://e.com");
  assert.deepEqual(spans[7].annotations, { strikethrough: true });
});

test("a round trip through markdown keeps the text and the structure", () => {
  const source = ["# Heading", "", "Body with **bold**.", "", "- one", "  - two", "", "1. first", "2. second"].join("\n");
  assert.equal(toMarkdown(fromMarkdown(source)), source);
});

test("flatten keeps what a script branches on and drops the spans", () => {
  const [heading, todo, row] = flatten([
    { id: "h", type: "heading", level: 1, collapsible: true, text: t("H") },
    { id: "t", type: "to_do", checked: true, text: t("T") },
    { id: "r", type: "table_row", cells: [t("A"), t("B")] },
  ]);
  assert.deepEqual(heading, { id: "h", type: "heading", text: "H", hasChildren: false, level: 1, collapsible: true });
  assert.equal(todo.checked, true);
  assert.deepEqual(row.cells, ["A", "B"]);
});
