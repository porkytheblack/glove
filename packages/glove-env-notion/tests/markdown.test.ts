import assert from "node:assert/strict";
import test from "node:test";
import { fromMarkdown, inline, normalizeBlocks, toMarkdown } from "../src/markdown";
import { plainText, type RawBlock } from "../src/model";
import { text } from "./fake";

const block = (id: string, type: string, body: Record<string, unknown>, children?: RawBlock[]): RawBlock =>
  ({ object: "block", id, type, has_children: !!children, [type]: body, ...(children ? { children } : {}) }) as RawBlock;

test("a span array renders with its annotations, not without them", () => {
  const spans = [
    { type: "text", plain_text: "See ", annotations: {} },
    { type: "text", plain_text: "the spec", href: "https://example.com", annotations: {} },
    { type: "text", plain_text: " — ", annotations: {} },
    { type: "text", plain_text: "urgent", annotations: { bold: true } },
    { type: "text", plain_text: " and ", annotations: {} },
    { type: "text", plain_text: "gone", annotations: { strikethrough: true } },
    { type: "equation", equation: { expression: "e^{i\\pi}" } },
  ];
  const md = toMarkdown([block("p", "paragraph", { rich_text: spans })]);
  assert.equal(md, "See [the spec](https://example.com) — **urgent** and ~~gone~~$e^{i\\pi}$");
});

test("code wraps innermost so the other markers survive it", () => {
  const md = toMarkdown([
    block("p", "paragraph", { rich_text: [{ type: "text", plain_text: "x", annotations: { code: true, bold: true } }] }),
  ]);
  assert.equal(md, "**`x`**");
});

test("nesting is structure, and indentation follows it", () => {
  const tree = [
    block("a", "bulleted_list_item", { rich_text: text("Parent") }, [
      block("b", "bulleted_list_item", { rich_text: text("Child") }, [
        block("c", "to_do", { rich_text: text("Deep"), checked: true }),
      ]),
    ]),
  ];
  assert.equal(toMarkdown(tree), "- Parent\n  - Child\n    - [x] Deep");
});

test("a numbered list counts its own siblings", () => {
  const tree = [
    block("a", "numbered_list_item", { rich_text: text("One") }),
    block("b", "numbered_list_item", { rich_text: text("Two") }),
    block("c", "paragraph", { rich_text: text("Break") }),
    block("d", "numbered_list_item", { rich_text: text("One again") }),
  ];
  assert.equal(toMarkdown(tree), "1. One\n2. Two\n\nBreak\n\n1. One again");
});

test("a simple table renders as a table, header honoured", () => {
  const tree = [
    block("t", "table", { table_width: 2, has_column_header: true }, [
      block("r1", "table_row", { cells: [text("Region"), text("Revenue")] }),
      block("r2", "table_row", { cells: [text("EMEA"), text("2.4M")] }),
    ]),
  ];
  assert.equal(toMarkdown(tree), "| Region | Revenue |\n| --- | --- |\n| EMEA | 2.4M |");
});

test("an unsupported block is a comment carrying its id, never a thrown error", () => {
  // The API models fewer block types than the product ships. A page must
  // still render.
  const md = toMarkdown([
    block("x", "unsupported", {}),
    block("y", "some_block_shipped_last_tuesday", { rich_text: text("hi") }),
    block("z", "paragraph", { rich_text: text("after") }),
  ]);
  assert.match(md, /<!-- unsupported block x/);
  assert.match(md, /<!-- some_block_shipped_last_tuesday block y: hi -->/);
  assert.match(md, /after/);
});

test("columns and synced blocks render their contents, not themselves", () => {
  const tree = [
    block("cl", "column_list", {}, [
      block("c1", "column", {}, [block("p1", "paragraph", { rich_text: text("Left") })]),
      block("c2", "column", {}, [block("p2", "paragraph", { rich_text: text("Right") })]),
    ]),
    block("s", "synced_block", { synced_from: { block_id: "orig" } }, [
      block("p3", "paragraph", { rich_text: text("Mirrored") }),
    ]),
  ];
  // Paragraphs stay paragraphs — a blank line between them is the markdown.
  assert.equal(toMarkdown(tree), "Left\n\nRight\n\nMirrored");
});

test("a code block keeps its language and survives a fence in its body", () => {
  const md = toMarkdown([block("c", "code", { rich_text: text("a\n```\nb"), language: "javascript" })]);
  assert.equal(md, "````javascript\na\n```\nb\n````");
});

test("markdown converts to the blocks the API accepts", () => {
  const blocks = fromMarkdown(
    ["# Title", "", "Some **bold** text.", "", "- one", "  - nested", "- [ ] todo", "", "1. first", "", "> quoted", "", "---", "", "```js", "const x = 1;", "```"].join("\n"),
  );
  const types = blocks.map((b) => b.type);
  assert.deepEqual(types, [
    "heading_1",
    "paragraph",
    "bulleted_list_item",
    "to_do",
    "numbered_list_item",
    "quote",
    "divider",
    "code",
  ]);

  const bullet = blocks[2] as unknown as { bulleted_list_item: { children: RawBlock[] } };
  assert.equal(bullet.bulleted_list_item.children.length, 1);
  assert.equal(bullet.bulleted_list_item.children[0].type, "bulleted_list_item");

  const code = blocks[7] as unknown as { code: { language: string; rich_text: [{ text: { content: string } }] } };
  assert.equal(code.code.language, "js");
  assert.equal(code.code.rich_text[0].text.content, "const x = 1;");
});

test("empty children arrays are pruned, because the API rejects them", () => {
  const [bullet] = fromMarkdown("- alone") as unknown as Array<{ bulleted_list_item: Record<string, unknown> }>;
  assert.equal("children" in bullet.bulleted_list_item, false);
});

test("inline markdown becomes annotated spans", () => {
  const spans = inline("a **b** and `c` and [d](https://e.com) and ~~f~~");
  assert.equal(plainText(spans.map((s) => ({ ...s, plain_text: s.text?.content }))), "a b and c and d and f");
  assert.deepEqual(spans[1].annotations, { bold: true });
  assert.deepEqual(spans[3].annotations, { code: true });
  assert.equal(spans[5].text?.link?.url, "https://e.com");
  assert.deepEqual(spans[7].annotations, { strikethrough: true });
});

test("a round trip through markdown keeps the text and the structure", () => {
  const source = ["# Heading", "", "Body with **bold**.", "", "- one", "  - two", "", "1. first", "2. second"].join("\n");
  assert.equal(toMarkdown(fromMarkdown(source) as RawBlock[]), source);
});

test("normalize keeps what a script branches on", () => {
  const [heading, todo, row] = normalizeBlocks([
    block("h", "heading_1", { rich_text: text("H"), is_toggleable: true }),
    block("t", "to_do", { rich_text: text("T"), checked: true }),
    block("r", "table_row", { cells: [text("A"), text("B")] }),
  ]);
  assert.deepEqual(heading, { id: "h", type: "heading_1", text: "H", hasChildren: false, level: 1, toggleable: true });
  assert.equal(todo.checked, true);
  assert.deepEqual(row.cells, ["A", "B"]);
});
