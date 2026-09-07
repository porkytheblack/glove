/**
 * Markdown in, block tree out — and back.
 *
 * A page's content is a tree of blocks whose text is a tree of spans. Handing
 * that to a model verbatim costs hundreds of tokens for a paragraph and
 * teaches it nothing it can act on. Markdown is the format it already writes,
 * so `env:base` reads pages *as* markdown and accepts markdown when writing
 * them.
 *
 * Deliberately lossy one way and conservative the other:
 *
 * - **Rendering** handles everything it recognizes and emits an HTML comment
 *   carrying the block's id for everything it does not. A page never fails to
 *   render because a backend shipped a block type this week, and the comment
 *   keeps the block reachable through `blocks.children`.
 * - **Parsing** covers the shapes a model types without being asked —
 *   headings, the three list kinds, quotes, code, dividers, paragraphs, with
 *   inline bold, italic, strikethrough, code and links. Anything richer is
 *   built as blocks and passed through. Text is never silently dropped: a line
 *   nothing else matches becomes a paragraph.
 */
import { plainText, span, type Block, type RichText, type Span } from "./model";

// --------------------------------------------------------- blocks → text

/** Render a block tree as markdown. */
export function toMarkdown(blocks: Block[]): string {
  return render(blocks ?? [], "").replace(/\n{3,}/g, "\n\n").trim();
}

const LIST_TYPES = new Set(["bulleted_list_item", "numbered_list_item", "to_do"]);

function render(blocks: Block[], indent: string): string {
  const out: string[] = [];
  let ordinal = 0;
  let previous = "";

  for (const block of blocks) {
    if (block.type === "numbered_list_item") ordinal += 1;
    else ordinal = 0;

    // A numbered item directly under a bulleted one, with no blank line
    // between, is a different list to the source and the same list to most
    // markdown parsers. The blank line is what keeps them apart.
    if (LIST_TYPES.has(previous) && previous !== block.type) out.push("");
    previous = block.type;

    const chunk = renderBlock(block, indent, ordinal);
    if (chunk !== "") out.push(chunk);
  }
  return out.join("\n");
}

function renderBlock(block: Block, indent: string, ordinal: number): string {
  const text = renderSpans(block.text);
  const kids = block.children ?? [];
  const nested = (pad: string) => (kids.length > 0 ? `\n${render(kids, indent + pad)}` : "");
  const line = (content: string) => `${indent}${content}`;

  switch (block.type) {
    case "paragraph":
      return `${line(text)}\n${nested("  ")}`;

    case "heading": {
      const level = block.level ?? 1;
      return `\n${line(`${"#".repeat(Math.min(6, Math.max(1, level)))} ${text}`)}\n${nested("")}`;
    }

    case "bulleted_list_item":
      return `${line(`- ${text}`)}${nested("  ")}`;
    case "numbered_list_item":
      return `${line(`${ordinal || 1}. ${text}`)}${nested("   ")}`;
    case "to_do":
      return `${line(`- [${block.checked ? "x" : " "}] ${text}`)}${nested("  ")}`;
    case "toggle":
      return `${line(`- ${text}`)}${nested("  ")}`;
    case "quote":
      return `${line(`> ${text}`)}${nested("  ")}`;
    case "callout":
      return `${line(`> ${block.icon && !/^https?:/i.test(block.icon) ? `${block.icon} ` : ""}${text}`)}${nested("  ")}`;

    case "code": {
      const source = plainText(block.text);
      const fence = source.includes("```") ? "````" : "```";
      const language = block.language && block.language !== "plain text" ? block.language : "";
      return `${line(`${fence}${language}`)}\n${source}\n${line(fence)}\n`;
    }

    case "equation":
      return `${line("$$")}\n${line(block.expression ?? plainText(block.text))}\n${line("$$")}\n`;

    case "divider":
      return `${line("---")}\n`;

    case "image":
      return `${line(`![${plainText(block.caption)}](${block.url ?? ""})`)}\n`;

    case "video":
    case "audio":
    case "file": {
      const label = plainText(block.caption) || block.title || block.type;
      return `${line(`[${label}](${block.url ?? ""})`)}\n`;
    }

    case "embed":
    case "bookmark": {
      const url = block.url ?? "";
      return `${line(`[${plainText(block.caption) || block.title || url}](${url})`)}\n`;
    }

    case "table":
      return renderTable(block, indent);
    case "table_row":
      // Only reachable when a caller renders rows detached from their table.
      return line(`| ${(block.cells ?? []).map((cell) => renderSpans(cell)).join(" | ")} |`);

    case "columns":
    case "column":
    case "synced":
      // Containers with nothing of their own to say. A synced duplicate holds
      // the original's children, so this renders the mirrored content rather
      // than a reference to it.
      return kids.length > 0 ? render(kids, indent) : "";

    case "child_page":
      return line(`- [${block.title || text || "Untitled"}](${block.url ?? refLink(block.id)})`);
    case "child_collection":
      return line(`- [${block.title || text || "Untitled"}](${block.url ?? refLink(block.id)}) — collection`);

    case "breadcrumb":
    case "table_of_contents":
      return line(`<!-- ${block.type} -->`);

    case "unsupported":
      return line(
        `<!-- unsupported block${block.id ? ` ${block.id}` : ""} — the backend has no model for it; open it there -->`,
      );

    default:
      return `${line(`<!-- ${block.type} block${block.id ? ` ${block.id}` : ""}${text ? `: ${text}` : ""} -->`)}${nested("  ")}`;
  }
}

function refLink(id: string | undefined): string {
  return id ? `#${id}` : "#";
}

function renderTable(table: Block, indent: string): string {
  const rows = (table.children ?? []).filter((child) => child.type === "table_row");
  if (rows.length === 0) return "";
  const cellsOf = (row: Block) => (row.cells ?? []).map((cell) => renderSpans(cell));
  const width = Math.max(table.columns ?? 0, ...rows.map((row) => (row.cells ?? []).length), 1);
  const pad = (cells: string[]) => Array.from({ length: width }, (_, i) => cells[i] ?? "");

  const lines: string[] = [];
  const header = table.hasHeader ? pad(cellsOf(rows[0])) : Array.from({ length: width }, () => "");
  lines.push(`${indent}| ${header.join(" | ")} |`);
  lines.push(`${indent}| ${header.map(() => "---").join(" | ")} |`);
  for (const row of table.hasHeader ? rows.slice(1) : rows) {
    lines.push(`${indent}| ${pad(cellsOf(row)).join(" | ")} |`);
  }
  return `${lines.join("\n")}\n`;
}

/** One span array as inline markdown. */
export function renderSpans(spans: RichText | string | undefined): string {
  if (typeof spans === "string") return spans;
  if (!Array.isArray(spans)) return "";
  return spans.map(renderSpan).join("");
}

function renderSpan(one: Span): string {
  if (one?.equation) return `$${one.equation}$`;

  let text = one?.text ?? "";
  if (text === "") return "";
  const a = one?.annotations ?? {};

  // Order matters: a code fence swallows the other markers, so it wraps
  // innermost, and the link wraps everything.
  if (a.code) text = `\`${text}\``;
  if (a.bold) text = `**${text}**`;
  if (a.italic) text = `*${text}*`;
  if (a.strikethrough) text = `~~${text}~~`;

  const href = one?.href ?? one?.mention?.url ?? (one?.mention?.id ? refLink(one.mention.id) : undefined);
  return href ? `[${text}](${href})` : text;
}

// --------------------------------------------------------- text → blocks

/** Markdown → blocks. A subset, on purpose — see the module note. */
export function fromMarkdown(markdown: string): Block[] {
  const lines = String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
  const root: Block[] = [];
  // One frame per indent level, so `  - nested` lands under the item above it.
  const stack: Array<{ indent: number; blocks: Block[] }> = [{ indent: -1, blocks: root }];

  const push = (indent: number, block: Block, container?: Block[]) => {
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    stack[stack.length - 1].blocks.push(block);
    if (container) stack.push({ indent, blocks: container });
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const indent = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (trimmed === "") continue;

    const fence = /^(`{3,}|~{3,})(.*)$/.exec(trimmed);
    if (fence) {
      const marker = fence[1][0].repeat(3);
      const language = fence[2].trim();
      const source: string[] = [];
      i++;
      for (; i < lines.length; i++) {
        if (lines[i].trim().startsWith(marker)) break;
        source.push(lines[i]);
      }
      push(indent, { type: "code", text: span(source.join("\n")), ...(language ? { language } : {}) });
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      push(indent, { type: "divider" });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      const level = Math.min(3, heading[1].length) as 1 | 2 | 3;
      push(indent, { type: "heading", level, text: inline(heading[2]) });
      continue;
    }

    const todo = /^[-*+]\s+\[([ xX])\]\s*(.*)$/.exec(trimmed);
    if (todo) {
      const block: Block = { type: "to_do", checked: todo[1].toLowerCase() === "x", text: inline(todo[2]), children: [] };
      push(indent, block, block.children);
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      const block: Block = { type: "bulleted_list_item", text: inline(bullet[1]), children: [] };
      push(indent, block, block.children);
      continue;
    }

    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (numbered) {
      const block: Block = { type: "numbered_list_item", text: inline(numbered[1]), children: [] };
      push(indent, block, block.children);
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(trimmed);
    if (quote) {
      push(indent, { type: "quote", text: inline(quote[1]) });
      continue;
    }

    push(indent, { type: "paragraph", text: inline(trimmed) });
  }

  return prune(root);
}

/** An empty `children` array says "this has children" to a reader. It does not. */
function prune(blocks: Block[]): Block[] {
  for (const block of blocks) {
    if (Array.isArray(block.children)) {
      if (block.children.length === 0) delete block.children;
      else prune(block.children);
    }
  }
  return blocks;
}

const INLINE = /(\[([^\]]*)\]\(([^)\s]+)\))|(`([^`]+)`)|(\*\*([^*]+)\*\*)|(~~([^~]+)~~)|(\*([^*]+)\*)|(_([^_]+)_)/;

/** Inline markdown → spans. Unmatched text stays plain rather than being escaped away. */
export function inline(text: string): RichText {
  const spans: RichText = [];
  let rest = String(text ?? "");

  while (rest !== "") {
    const match = INLINE.exec(rest);
    if (!match || match.index === undefined) break;

    if (match.index > 0) spans.push(...span(rest.slice(0, match.index)));

    if (match[1] !== undefined) spans.push(...span(match[2], { href: match[3] }));
    else if (match[4] !== undefined) spans.push(...span(match[5], { annotations: { code: true } }));
    else if (match[6] !== undefined) spans.push(...span(match[7], { annotations: { bold: true } }));
    else if (match[8] !== undefined) spans.push(...span(match[9], { annotations: { strikethrough: true } }));
    else if (match[10] !== undefined) spans.push(...span(match[11], { annotations: { italic: true } }));
    else if (match[12] !== undefined) spans.push(...span(match[13], { annotations: { italic: true } }));

    rest = rest.slice(match.index + match[0].length);
  }

  if (rest !== "") spans.push(...span(rest));
  return spans;
}

// ------------------------------------------------------------- summarizing

/** A block with its text flattened — what a script branches on. */
export interface FlatBlock {
  id?: string;
  type: string;
  text: string;
  hasChildren: boolean;
  children?: FlatBlock[];
  checked?: boolean;
  level?: number;
  collapsible?: boolean;
  language?: string;
  url?: string;
  caption?: string;
  cells?: string[];
  title?: string;
}

/**
 * Flatten a tree for a script that wants structure but not spans.
 *
 * `blocks.children()` returns this; `{ raw: true }` returns the model's own
 * {@link Block}s, spans and all.
 */
export function flatten(blocks: Block[]): FlatBlock[] {
  return (blocks ?? []).map((block) => {
    const out: FlatBlock = {
      ...(block.id ? { id: block.id } : {}),
      type: block.type,
      text: plainText(block.text),
      hasChildren: block.hasChildren === true || (block.children?.length ?? 0) > 0,
    };
    if (block.children && block.children.length > 0) out.children = flatten(block.children);
    if (block.checked !== undefined) out.checked = block.checked;
    if (block.level !== undefined) out.level = block.level;
    if (block.collapsible !== undefined) out.collapsible = block.collapsible;
    if (block.language !== undefined) out.language = block.language;
    if (block.url !== undefined) out.url = block.url;
    if (block.title !== undefined) out.title = block.title;
    const caption = plainText(block.caption);
    if (caption !== "") out.caption = caption;
    if (block.cells) out.cells = block.cells.map((cell) => plainText(cell));
    return out;
  });
}
