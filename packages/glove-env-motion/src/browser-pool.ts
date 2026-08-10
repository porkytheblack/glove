/**
 * One Chromium per environment, and a hard ceiling on how many exist at once.
 *
 * Two problems that look like one. A render used to `chromium.launch()` and
 * `browser.close()` around every call, so the second still in a session paid
 * the launch again — measured at 4.6s cold and ~150ms warm on this host, on
 * top of a still that is otherwise well under a second. And because each
 * environment did that independently, N agents rendering at once meant N
 * Chromiums, each with `--no-sandbox`, with nothing anywhere counting them:
 * `maxFrames` bounds one render, not the fleet.
 *
 * So the browser is kept, keyed per adapter instance — one environment, one
 * browser, never shared between tenants — and the *number* of browsers is
 * capped process-wide. The cap has to be module state: it is the only scope
 * that sees every environment in the process, which is exactly the scope the
 * problem lives at.
 *
 * Isolation is unchanged. A render still gets a fresh browser **context**, so
 * it starts with empty storage, no cookies and no leftover page state; what it
 * reuses is the process, not the session. Frames stay byte-identical — pinned
 * by a test that renders the same frame on a cold browser and on a reused one
 * and compares the bytes.
 *
 * The dangerous failure here is a deadlock: a permit that is never given back
 * stops every other environment in the process forever. Three things prevent
 * it. A lease is released in a `finally`, so a render that throws still gives
 * it up. A browser nobody is using is closed to make room rather than waited
 * on, so idle environments cannot block a busy one. And a wait has a deadline,
 * after which the caller gets an error naming the cap instead of hanging.
 */
import { chromium, type Browser } from "playwright-core";

export class BrowserFleetError extends Error {}

/**
 * Chromium flags. Lifted verbatim from the per-render launch — the last four
 * are what make two renders of the same frame produce the same bytes.
 */
export const CHROMIUM_ARGS = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--force-device-scale-factor=1",
  "--hide-scrollbars",
  // Subpixel antialiasing samples the background, so the same glyph renders
  // differently over different pixels. Off, text is stable and frames stay
  // comparable.
  "--disable-lcd-text",
  "--font-render-hinting=none",
  "--disable-skia-runtime-opts",
];

/**
 * Concurrent browsers allowed across every environment in the process.
 *
 * Two by default. A headless Chromium is a few hundred MB, the host running
 * these is usually running other agents too, and erring low is the recoverable
 * direction: too low is a queue, too high is the OOM killer taking down every
 * environment in the process at once. Raise it with `motion({ maxBrowsers })`
 * or `GLOVE_MOTION_MAX_BROWSERS` on a box that has the memory.
 */
export const DEFAULT_MAX_BROWSERS = 2;

/** How long a browser nobody is rendering with is kept before it is closed. */
export const DEFAULT_IDLE_MS = 30_000;

function envCap(): number | null {
  const raw = process.env.GLOVE_MOTION_MAX_BROWSERS;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

let cap = envCap() ?? DEFAULT_MAX_BROWSERS;

/**
 * Lower the fleet cap.
 *
 * Deliberately a floor and not an assignment. The cap is one number shared by
 * every environment in the process, and adapters mounted by different parts of
 * a host will disagree about it; when they do, the smallest wins, because the
 * cap exists to protect a machine they are all sitting on. `GLOVE_MOTION_MAX_BROWSERS`
 * sets the starting value and is how an operator raises it.
 */
export function limitBrowserFleet(n: number): void {
  if (!Number.isInteger(n) || n < 1) {
    throw new BrowserFleetError(`maxBrowsers must be a whole number of 1 or more, got ${n}`);
  }
  cap = Math.min(cap, n);
}

/** The cap currently in force. */
export function browserFleetCap(): number {
  return cap;
}

interface Entry {
  key: string;
  /** Resolves to the browser. Registered before the launch is awaited, so two
   *  environments racing for the same key join one launch instead of two. */
  ready: Promise<Browser>;
  /** Renders currently holding this browser. Never evicted above zero. */
  inUse: number;
  lastUsed: number;
  idleTimer?: NodeJS.Timeout;
  idleMs: number;
  closing: boolean;
}

const browsers = new Map<string, Entry>();
const waiters = new Set<() => void>();
const counters = { launches: 0, peakOpen: 0, waits: 0 };

export interface BrowserLease {
  browser: Browser;
  /** Idempotent — a double release must not hand out a permit twice. */
  release(): void;
}

export interface AcquireOptions {
  /** Identity of the borrower: one key, one browser. */
  key: string;
  executablePath: string;
  /** Idle time before this browser is closed on its own. */
  idleMs?: number;
  /** How long to wait for a permit before failing. */
  waitMs?: number;
}

function wake(): void {
  for (const w of [...waiters]) w();
}

function cancelIdle(entry: Entry): void {
  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = undefined;
  }
}

function armIdle(entry: Entry): void {
  cancelIdle(entry);
  // `unref` so a browser waiting to time out never keeps the process alive:
  // an idle renderer must not be the reason a CLI refuses to exit.
  entry.idleTimer = setTimeout(() => {
    void closeEntry(entry);
  }, entry.idleMs);
  entry.idleTimer.unref?.();
}

async function closeEntry(entry: Entry): Promise<void> {
  if (entry.inUse > 0 || entry.closing) return;
  entry.closing = true;
  cancelIdle(entry);
  browsers.delete(entry.key);
  try {
    const browser = await entry.ready;
    await browser.close();
  } catch {
    /* already gone, or never came up */
  }
  wake();
}

/** Forget a browser that failed to launch or has disconnected. */
function discard(entry: Entry): void {
  cancelIdle(entry);
  if (browsers.get(entry.key) === entry) browsers.delete(entry.key);
  entry.closing = true;
  wake();
}

function leastRecentlyUsedIdle(): Entry | undefined {
  let best: Entry | undefined;
  for (const e of browsers.values()) {
    if (e.inUse > 0 || e.closing) continue;
    if (!best || e.lastUsed < best.lastUsed) best = e;
  }
  return best;
}

/** Wait until something is released, or the deadline passes. */
function waitForRelease(ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    let timer: NodeJS.Timeout;
    const done = (freed: boolean) => {
      waiters.delete(notify);
      clearTimeout(timer);
      resolve(freed);
    };
    const notify = () => done(true);
    waiters.add(notify);
    timer = setTimeout(() => done(false), ms);
    timer.unref?.();
  });
}

export async function acquireBrowser(options: AcquireOptions): Promise<BrowserLease> {
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const deadline = Date.now() + (options.waitMs ?? 120_000);

  for (;;) {
    const existing = browsers.get(options.key);
    if (existing && !existing.closing) {
      // Claim before awaiting: an entry with `inUse > 0` cannot be evicted, so
      // the browser this render is waiting on cannot be closed underneath it.
      existing.inUse++;
      cancelIdle(existing);
      try {
        const browser = await existing.ready;
        if (browser.isConnected()) {
          existing.lastUsed = Date.now();
          return lease(existing, browser);
        }
      } catch {
        /* the launch this entry represents failed */
      }
      // Crashed or stillborn: drop it and go round again to launch a new one.
      existing.inUse--;
      discard(existing);
      continue;
    }

    if (browsers.size >= cap) {
      const idle = leastRecentlyUsedIdle();
      if (idle) {
        // Nobody is using it — take its permit rather than queue behind it.
        await closeEntry(idle);
        continue;
      }
      const remaining = deadline - Date.now();
      counters.waits++;
      if (remaining <= 0 || !(await waitForRelease(remaining))) {
        throw new BrowserFleetError(
          `waited for a browser: ${cap} ${cap === 1 ? "is" : "are"} already rendering and the fleet cap (maxBrowsers) is ${cap}. ` +
            "Raise it with motion({ maxBrowsers: n }) or GLOVE_MOTION_MAX_BROWSERS if the host has the memory, or render fewer scenes at once.",
        );
      }
      continue;
    }

    const entry: Entry = {
      key: options.key,
      inUse: 1,
      lastUsed: Date.now(),
      idleMs,
      closing: false,
      ready: undefined as unknown as Promise<Browser>,
    };
    counters.launches++;
    entry.ready = chromium.launch({ executablePath: options.executablePath, args: CHROMIUM_ARGS });
    browsers.set(options.key, entry);
    counters.peakOpen = Math.max(counters.peakOpen, browsers.size);
    try {
      return lease(entry, await entry.ready);
    } catch (e) {
      entry.inUse--;
      discard(entry);
      throw e;
    }
  }
}

function lease(entry: Entry, browser: Browser): BrowserLease {
  let released = false;
  return {
    browser,
    release() {
      if (released) return;
      released = true;
      entry.inUse--;
      entry.lastUsed = Date.now();
      if (entry.inUse === 0) armIdle(entry);
      wake();
    },
  };
}

/**
 * Close every browser this process holds.
 *
 * A host should call this on shutdown. It is also what a test suite calls
 * after its last render, so the run does not sit waiting for idle timers.
 */
export async function closeMotionBrowsers(): Promise<void> {
  const open = [...browsers.values()];
  for (const entry of open) entry.inUse = 0;
  await Promise.all(open.map((e) => closeEntry(e)));
}

/** What the fleet is doing right now — for tests, benchmarks and diagnostics. */
export function browserFleetStats(): {
  open: number;
  inUse: number;
  cap: number;
  launches: number;
  peakOpen: number;
  waits: number;
} {
  let inUse = 0;
  for (const e of browsers.values()) if (e.inUse > 0) inUse++;
  return { open: browsers.size, inUse, cap, launches: counters.launches, peakOpen: counters.peakOpen, waits: counters.waits };
}

/** Reset the observed counters (not the browsers) — benchmarks measure phases. */
export function resetBrowserFleetCounters(): void {
  counters.launches = 0;
  counters.peakOpen = browsers.size;
  counters.waits = 0;
}
