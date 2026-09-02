/**
 * Markdown in, block tree out — and back.
 *
 * A page's content is a tree of blocks whose text is a tree of spans. Handing
 * that to a model verbatim costs hundreds of tokens for a paragraph and
 * teaches it nothing it can act on. Markdown is the format it already writes,
 * so the adapter reads pages *as* markdown and accepts markdown when writing
 * them.
 *
 * The conversion is deliberately lossy in one direction and conservative in
 * the other:
 *
 * - **Reading** renders everything it recognizes and emits an HTML comment
 *   for everything it does not, `unsupported` included. A page never fails to
 *   render because Notion shipped a block type this week; the comment carries
 *   the id, so the block is still reachable through `blocks.children`.
 * - **Writing** supports the block types a model actually types — headings,
 *   the three list kinds, quotes, code, dividers, paragraphs — with inline
 *   bold, italic, strikethrough, code and links. Anything else should be
 *   built as blocks and passed through, which `pages.append` also accepts.
 */
import { plainText, richText, spanText, type RawBlock, type RichText } from "./model";

/** A block reduced to what a script usually wants. */
export interface NotionBlock {
  id: string;
  type: string;
  /** The block's text with formatting discarded. Empty for blocks that hold none. */
  text: string;
  hasChildren: boolean;
  children?: NotionBlock[];
  /** `to_do` only. */
  checked?: boolean;
  /** `code` only. */
  language?: string;
  /** Media, embeds and bookmarks. Notion-hosted URLs expire — see `download`. */
  url?: string;
  /** Media caption, when there is one. */
  caption?: string;
  /** 1, 2 or 3 for headings. */
  level?: number;
  /** A toggle heading is `heading_n` with this set — not a separate type. */
  toggleable?: boolean;
  /** `table_row` only: each cell's plain text. */
  cells?: string[];
}

const CHILDREN_KEY = "children";

/**
 * A block's children, from either place they live.
 *
 * The fetcher attaches them to the envelope, because that is where a reader
 * wants them. The API expects them *inside* the type payload when a block is
 * written. Reading both means a tree built by `fromMarkdown` renders back
 * through `toMarkdown` unchanged, which is the only way a round trip is
 * checkable at all.
 */
function childrenOf(block: RawBlock): RawBlock[] {
  const attached = (block as Record<string, unknown>)[CHILDREN_KEY];
  if (Array.isArray(attached)) return attached as RawBlock[];
  const nested = payload(block).children;
  return Array.isArray(nested) ? (nested as RawBlock[]) : [];
}

function payload(block: RawBlock): Record<string, unknown> {
  const value = (block as Record<string, unknown>)[block.type];
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function spansOf(block: RawBlock): RichText[] {
  const rich = payload(block).rich_text;
  return Array.isArray(rich) ? (rich as RichText[]) : [];
}

function fileUrl(body: Record<string, unknown>): string {
  const external = body.external as { url?: string } | undefined;
  const hosted = body.file as { url?: string } | undefined;
  return external?.url ?? hosted?.url ?? "";
}

// ------------------------------------------------------------- normalize

/** A raw block tree reduced to {@link NotionBlock}s. */
export function normalizeBlocks(blocks: RawBlock[]): NotionBlock[] {
  return blocks.map(normalizeBlock);
}

export function normalizeBlock(block: RawBlock): NotionBlock {
  const body = payload(block);
  const kids = childrenOf(block);
  const heading = /^heading_([123])$/.exec(block.type);

  const out: NotionBlock = {
    id: block.id,
    type: block.type,
    text: plainText(spansOf(block)),
    hasChildren: block.has_children === true || kids.length > 0,
  };
  if (kids.length > 0) out.children = normalizeBlocks(kids);
  if (heading) {
    out.level = Number(heading[1]);
    if (body.is_toggleable === true) out.toggleable = true;
  }
  if (block.type === "to_do") out.checked = body.checked === true;
  if (block.type === "code" && typeof body.language === "string") out.language = body.language;
  if (block.type === "table_row") {
    const cells = Array.isArray(body.cells) ? (body.cells as RichText[][]) : [];
    out.cells = cells.map((cell) => plainText(cell));
  }
  const url = typeof body.url === "string" ? body.url : fileUrl(body);
  if (url) out.url = url;
  const caption = Array.isArray(body.caption) ? plainText(body.caption as RichText[]) : "";
  if (caption) out.caption = caption;
  return out;
}

// --------------------------------------------------------- blocks → text

/** Render a raw block tree as markdown. */
export function toMarkdown(blocks: RawBlock[]): string {
  return render(blocks, "").replace(/\n{3,}/g, "\n\n").trim();
}

const LIST_TYPES = new Set(["bulleted_list_item", "numbered_list_item", "to_do"]);

function render(blocks: RawBlock[], indent: string): string {
  const out: string[] = [];
  let ordinal = 0;
  let previous = "";

  for (const block of blocks) {
    if (block.type === "numbered_list_item") ordinal += 1;
    else ordinal = 0;

    // A numbered item directly under a bulleted one, with no blank line
    // between, is a different list to Notion and the same list to most
    // markdown parsers. The blank line is what keeps them apart.
    if (LIST_TYPES.has(previous) && previous !== block.type) out.push("");
    previous = block.type;

    const chunk = renderBlock(block, indent, ordinal);
    if (chunk !== "") out.push(chunk);
  }
  return out.join("\n");
}

function renderBlock(block: RawBlock, indent: string, ordinal: number): string {
  const body = payload(block);
  const text = renderSpans(spansOf(block));
  const kids = childrenOf(block);
  const nested = (pad: string) => (kids.length > 0 ? `\n${render(kids, indent + pad)}` : "");
  const line = (content: string) => `${indent}${content}`;

  switch (block.type) {
    case "paragraph":
      return `${line(text)}\n${nested("  ")}`;
    case "heading_1":
    case "heading_2":
    case "heading_3": {
      const level = Number(block.type.slice(-1));
      return `\n${line(`${"#".repeat(level)} ${text}`)}\n${nested("")}`;
    }
    case "bulleted_list_item":
      return `${line(`- ${text}`)}${nested("  ")}`;
    case "numbered_list_item":
      return `${line(`${ordinal || 1}. ${text}`)}${nested("   ")}`;
    case "to_do":
      return `${line(`- [${body.checked === true ? "x" : " "}] ${text}`)}${nested("  ")}`;
    case "toggle":
      return `${line(`- ${text}`)}${nested("  ")}`;
    case "quote":
      return `${line(`> ${text}`)}${nested("  ")}`;
    case "callout": {
      const icon = calloutIcon(body.icon);
      return `${line(`> ${icon}${text}`)}${nested("  ")}`;
    }
    case "code": {
      const language = typeof body.language === "string" && body.language !== "plain text" ? body.language : "";
      const source = plainText(spansOf(block));
      const fence = source.includes("```") ? "````" : "```";
      return `${line(`${fence}${language}`)}\n${source}\n${line(fence)}\n`;
    }
    case "equation":
      return `${line("$$")}\n${line(String(body.expression ?? ""))}\n${line("$$")}\n`;
    case "divider":
      return `${line("---")}\n`;
    case "image": {
      const caption = Array.isArray(body.caption) ? plainText(body.caption as RichText[]) : "";
      return `${line(`![${caption}](${fileUrl(body)})`)}\n`;
    }
    case "video":
    case "audio":
    case "file":
    case "pdf": {
      const caption = Array.isArray(body.caption) ? plainText(body.caption as RichText[]) : block.type;
      return `${line(`[${caption || block.type}](${fileUrl(body)})`)}\n`;
    }
    case "embed":
    case "bookmark":
    case "link_preview": {
      const url = String(body.url ?? "");
      const caption = Array.isArray(body.caption) ? plainText(body.caption as RichText[]) : "";
      return `${line(`[${caption || url}](${url})`)}\n`;
    }
    case "child_page":
      return `${line(`- [${String(body.title ?? "Untitled")}](${pageUrl(block.id)})`)}`;
    case "child_database":
      return `${line(`- [${String(body.title ?? "Untitled database")}](${pageUrl(block.id)}) — database`)}`;
    case "link_to_page": {
      const target = String(body.page_id ?? body.data_source_id ?? body.database_id ?? "");
      return `${line(`- [linked page](${pageUrl(target)})`)}`;
    }
    case "table":
      return renderTable(block, indent);
    case "table_row":
      // Only reachable when a caller renders rows detached from their table.
      return line(`| ${cellsOf(block).join(" | ")} |`);
    case "column_list":
    case "column":
    case "synced_block":
      // Containers with nothing of their own to say. A synced duplicate
      // returns the original's children, so this renders the mirrored
      // content rather than a reference to it.
      return kids.length > 0 ? render(kids, indent) : "";
    case "table_of_contents":
    case "breadcrumb":
      return `${line(`<!-- ${block.type} -->`)}`;
    case "unsupported":
      return `${line(`<!-- unsupported block ${block.id} — the API has no model for it; open it in Notion -->`)}`;
    default:
      return `${line(`<!-- ${block.type} block ${block.id}${text ? `: ${text}` : ""} -->`)}${nested("  ")}`;
  }
}

function cellsOf(row: RawBlock): string[] {
  const cells = payload(row).cells;
  return Array.isArray(cells) ? (cells as RichText[][]).map((cell) => renderSpans(cell)) : [];
}

function renderTable(table: RawBlock, indent: string): string {
  const rows = childrenOf(table).filter((child) => child.type === "table_row");
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((row) => cellsOf(row).length), 1);
  const pad = (cells: string[]) => Array.from({ length: width }, (_, i) => cells[i] ?? "");
  const hasHeader = payload(table).has_column_header === true;

  const lines: string[] = [];
  const header = hasHeader ? pad(cellsOf(rows[0])) : Array.from({ length: width }, () => "");
  lines.push(`${indent}| ${header.join(" | ")} |`);
  lines.push(`${indent}| ${header.map(() => "---").join(" | ")} |`);
  for (const row of hasHeader ? rows.slice(1) : rows) {
    lines.push(`${indent}| ${pad(cellsOf(row)).join(" | ")} |`);
  }
  return `${lines.join("\n")}\n`;
}

function calloutIcon(icon: unknown): string {
  if (!icon || typeof icon !== "object") return "";
  const emoji = (icon as { emoji?: string }).emoji;
  return typeof emoji === "string" ? `${emoji} ` : "";
}

function pageUrl(id: string): string {
  return `https://www.notion.so/${id.replace(/-/g, "")}`;
}

/** One span array as inline markdown. */
export function renderSpans(spans: RichText[] | undefined): string {
  if (!Array.isArray(spans)) return "";
  return spans.map(renderSpan).join("");
}

function renderSpan(span: RichText): string {
  if (span?.type === "equation" && span.equation?.expression) return `$${span.equation.expression}$`;

  let text = spanText(span);
  if (text === "") return "";
  const a = span?.annotations ?? {};

  // Order matters: code fences swallow the other markers, so it wraps
  // innermost, and the link wraps everything.
  if (a.code) text = `\`${text}\``;
  if (a.bold) text = `**${text}**`;
  if (a.italic) text = `*${text}*`;
  if (a.strikethrough) text = `~~${text}~~`;

  const href = span?.href ?? span?.text?.link?.url ?? null;
  if (href) text = `[${text}](${href})`;
  else if (span?.type === "mention" && span.mention?.page?.id) {
    text = `[${text}](${pageUrl(span.mention.page.id)})`;
  }
  return text;
}

// --------------------------------------------------------- text → blocks

/**
 * Markdown → the block payloads the API accepts.
 *
 * A subset, on purpose: the shapes a model writes without being asked to.
 * Indented list items nest. Fenced code keeps its language. Everything else
 * becomes a paragraph rather than being dropped, so no text is ever silently
 * lost on the way in.
 */
export function fromMarkdown(markdown: string): RawBlock[] {
  const lines = String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
  const root: RawBlock[] = [];
  // One frame per indent level, so `  - nested` lands under the item above it.
  const stack: Array<{ indent: number; blocks: RawBlock[] }> = [{ indent: -1, blocks: root }];

  const push = (indent: number, block: RawBlock, container?: RawBlock[]) => {
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    stack[stack.length - 1].blocks.push(block);
    if (container) stack.push({ indent, blocks: container });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

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
      push(indent, block("code", {
        rich_text: richText(source.join("\n")),
        language: language || "plain text",
      }));
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      push(indent, block("divider", {}));
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (heading) {
      push(indent, block(`heading_${heading[1].length}`, { rich_text: inline(heading[2]) }));
      continue;
    }

    const todo = /^[-*+]\s+\[([ xX])\]\s*(.*)$/.exec(trimmed);
    if (todo) {
      const body = { rich_text: inline(todo[2]), checked: todo[1].toLowerCase() === "x", children: [] as RawBlock[] };
      push(indent, block("to_do", body), body.children);
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      const body = { rich_text: inline(bullet[1]), children: [] as RawBlock[] };
      push(indent, block("bulleted_list_item", body), body.children);
      continue;
    }

    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (numbered) {
      const body = { rich_text: inline(numbered[1]), children: [] as RawBlock[] };
      push(indent, block("numbered_list_item", body), body.children);
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(trimmed);
    if (quote) {
      push(indent, block("quote", { rich_text: inline(quote[1]) }));
      continue;
    }

    push(indent, block("paragraph", { rich_text: inline(trimmed) }));
  }

  return prune(root);
}

/** Empty `children` arrays are rejected by the API, so they are dropped. */
function prune(blocks: RawBlock[]): RawBlock[] {
  for (const b of blocks) {
    const body = (b as Record<string, unknown>)[b.type] as Record<string, unknown>;
    const kids = body?.children;
    if (Array.isArray(kids)) {
      if (kids.length === 0) delete body.children;
      else prune(kids as RawBlock[]);
    }
  }
  return blocks;
}

function block(type: string, body: Record<string, unknown>): RawBlock {
  return { object: "block", type, [type]: body } as unknown as RawBlock;
}

const INLINE = /(\[([^\]]*)\]\(([^)\s]+)\))|(`([^`]+)`)|(\*\*([^*]+)\*\*)|(~~([^~]+)~~)|(\*([^*]+)\*)|(_([^_]+)_)/;

/** Inline markdown → spans. Unmatched text stays plain rather than being escaped away. */
export function inline(text: string): RichText[] {
  const spans: RichText[] = [];
  let rest = String(text ?? "");

  while (rest !== "") {
    const match = INLINE.exec(rest);
    if (!match || match.index === undefined) break;

    if (match.index > 0) spans.push(...richText(rest.slice(0, match.index)));

    if (match[1] !== undefined) spans.push(...richText(match[2], match[3]));
    else if (match[4] !== undefined) spans.push(...annotate(match[5], { code: true }));
    else if (match[6] !== undefined) spans.push(...annotate(match[7], { bold: true }));
    else if (match[8] !== undefined) spans.push(...annotate(match[9], { strikethrough: true }));
    else if (match[10] !== undefined) spans.push(...annotate(match[11], { italic: true }));
    else if (match[12] !== undefined) spans.push(...annotate(match[13], { italic: true }));

    rest = rest.slice(match.index + match[0].length);
  }

  if (rest !== "") spans.push(...richText(rest));
  return spans;
}

function annotate(text: string, annotations: Record<string, boolean>): RichText[] {
  return richText(text).map((span) => ({ ...span, annotations }));
}
