/**
 * Notion identifiers, and the four shapes they arrive in.
 *
 * A model working from a browser will paste a URL. A model working from an
 * earlier API response has a dashed UUID. A model working from an export has
 * the bare 32 hex characters. Copying a link to a database view appends a
 * `?v=`, and copying a link to a row inside one appends `?p=` — where the id
 * that matters is the query parameter, not the path.
 *
 * Every entry point here takes all of them, because the alternative is an
 * adapter that fails on the single most likely thing a model will type.
 */

const DASHED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DASHED_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const HEX_RUN = /[0-9a-f]+/gi;

/** `1a2b…` → `1a2b3c4d-…`. Already-dashed ids pass through. */
export function dashed(id: string): string {
  const bare = id.replace(/-/g, "");
  if (bare.length !== 32) return id;
  return [bare.slice(0, 8), bare.slice(8, 12), bare.slice(12, 16), bare.slice(16, 20), bare.slice(20)].join("-").toLowerCase();
}

/**
 * Pull an object id out of anything that carries one.
 *
 * Accepts a bare id, a dashed id, and any `notion.so` / `notion.site` URL.
 * For a URL the **query string wins**: `…/Tasks-<db>?p=<page>&pm=s` is the
 * link Notion copies for a row opened as a peek, and the id a reader wants
 * from it is the row, not the database it lives in.
 */
export function toId(input: string): string {
  if (typeof input !== "string" || input.trim() === "") {
    throw new Error("expected a Notion id or URL, got an empty value");
  }
  const raw = input.trim();

  if (DASHED.test(raw)) return raw.toLowerCase();
  if (/^[0-9a-f]{32}$/i.test(raw)) return dashed(raw);

  if (/^https?:\/\//i.test(raw)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error(`${JSON.stringify(input)} is not a usable Notion URL`);
    }
    // `p` is the peeked page; `v` is a *view*, never an object we can fetch,
    // so it is read past rather than matched.
    const peek = url.searchParams.get("p");
    if (peek) {
      const id = lastHex(peek);
      if (id) return id;
    }
    const fromPath = lastHex(decodeURIComponent(url.pathname));
    if (fromPath) return fromPath;
    throw new Error(
      `${JSON.stringify(input)} carries no Notion id. A shareable link ends in 32 hex characters — ` +
        `use "Copy link" rather than the address of a search result or a workspace home page.`,
    );
  }

  const loose = lastHex(raw);
  if (loose) return loose;
  throw new Error(
    `${JSON.stringify(input)} is not a Notion id or URL. Ids are 32 hex characters, with or without dashes.`,
  );
}

/** True when `input` looks like something {@link toId} can resolve. */
export function isId(input: unknown): boolean {
  if (typeof input !== "string") return false;
  try {
    toId(input);
    return true;
  } catch {
    return false;
  }
}

/**
 * The last id in a piece of text.
 *
 * Slugs are the reason this is not a single regex. `notion.so/Cafe-<id>`
 * concatenates to 36 hex characters once the dash is removed, and a plain
 * 32-character match then returns `Cafe` plus the first 28 characters of the
 * id — a well-formed id that addresses nothing. So: dashed UUIDs are matched
 * first, and otherwise each maximal run of hex is read from its **end**,
 * which is where a Notion id always sits.
 */
function lastHex(text: string): string | null {
  const uuids = text.match(DASHED_ANYWHERE);
  if (uuids && uuids.length > 0) return dashed(uuids[uuids.length - 1]);

  let found: string | null = null;
  for (const run of text.match(HEX_RUN) ?? []) {
    if (run.length >= 32) found = run.slice(run.length - 32);
  }
  return found === null ? null : dashed(found);
}
