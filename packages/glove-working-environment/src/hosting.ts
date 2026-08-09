/**
 * `createSessionManager` — the registry every host of this package writes.
 *
 * An environment is per-conversation and expensive: it owns a worker thread,
 * an in-memory tree, and whatever the adapters hold (`env:motion` keeps a
 * browser warm). So every host ends up with the same three things, and the
 * same three bugs.
 *
 * 1. **A get-or-create race.** `createWorkingEnvironment` is async, so the
 *    obvious `if (!map.has(id)) map.set(id, await create(id))` runs the create
 *    twice for two requests that arrive together — one environment is
 *    orphaned with its worker thread still alive and its `close()` never
 *    called, and the two requests act on different trees. Memoizing the
 *    *promise* is the fix, and it is the thing hand-written registries get
 *    wrong.
 * 2. **Eviction.** Without it, a tab left open for a day accumulates threads.
 *    With a naive version, a session is evicted while a script is running
 *    inside it — the pool is closed under the run, and the user is told the
 *    environment was closed part-way through a four-minute render.
 * 3. **Reaping from somewhere.** A timer keeps the process alive and does not
 *    exist on a serverless runtime; the workable answer is to reap on the way
 *    through whatever route is already handling a request, which means `reap`
 *    has to be cheap, idempotent, and safe to call concurrently.
 *
 * Deliberately generic over the session value rather than owning a
 * `WorkingEnvironment`: a real host's session is an environment *plus* an
 * agent, its listeners, and whatever else the turn needs. Give it `create`
 * and `dispose`; it owns the map, the race, and the clock.
 *
 * ```ts
 * const sessions = createSessionManager({
 *   globalKey: "__deskSessions",              // survives Next's dev reload
 *   idleMs: 30 * 60_000,
 *   create: (id) => buildDesk(id),
 *   dispose: (desk) => desk.env.close(),
 * });
 *
 * // in every route:
 * const desk = await sessions.get(sessionId);
 * void sessions.reap();
 * ```
 */

export interface SessionManagerOptions<S> {
  /**
   * Build the session. Called at most once per id no matter how many requests
   * arrive together; a create that REJECTS is not remembered, so the next
   * request retries rather than inheriting a permanently poisoned id.
   */
  create(id: string): Promise<S>;
  /**
   * Release everything the session holds — `env.close()` at minimum.
   *
   * Always awaited, and a throw is reported through `onWarning` rather than
   * propagated: eviction usually runs on a request that has nothing to do with
   * the session being dropped, and failing that request would be the wrong
   * user's error.
   */
  dispose(session: S, id: string): Promise<void> | void;
  /**
   * Evict a session untouched for this long. Default 30 minutes; `0` disables.
   *
   * "Touched" means `get`, `peek`, or an open lease (see {@link SessionManager.hold}).
   */
  idleMs?: number;
  /** Evict a session this old regardless of activity. Off by default. */
  maxAgeMs?: number;
  /**
   * Hard ceiling on live sessions; the least recently used go first.
   *
   * The backstop for the case idle eviction cannot help with — a burst of new
   * conversations inside one idle window, each holding a worker thread and up
   * to `maxVfsBytes` of heap.
   */
  max?: number;
  /** Told when a session is dropped, and why. Never allowed to fail an eviction. */
  onEvict?(event: { id: string; reason: "idle" | "age" | "capacity" | "explicit" | "shutdown" }): void;
  /** Where a failing `dispose` is reported. Defaults to `console.warn`. */
  onWarning?(message: string): void;
  /**
   * Reuse the manager stored at `globalThis[globalKey]`, creating it if absent.
   *
   * For dev servers that re-evaluate route modules on edit (Next's does): a
   * plain module-level `Map` is dropped on every save, taking every live
   * environment — and its worker threads — with it, mid-conversation. The
   * stored manager keeps the `create`/`dispose` it was first built with, which
   * is the point: existing sessions keep working across the reload.
   */
  globalKey?: string;
  /** Clock seam, for tests. Defaults to `Date.now`. */
  now?(): number;
}

export interface SessionManager<S> {
  /**
   * The session for `id`, creating it if this is the first ask.
   *
   * Concurrent callers share one create and one session. Touches the entry, so
   * a session in active use is never idle-evicted.
   */
  get(id: string): Promise<S>;
  /**
   * The session for `id` if it already exists and has finished being created,
   * without creating one. Touches it — a caller looking at a session is using
   * it.
   */
  peek(id: string): S | undefined;
  /**
   * Pin a session for the length of a turn.
   *
   * `get` marks the session used at the moment it is handed over, which is not
   * enough for the work this package is for: a turn can spend four minutes
   * inside one `run_script`, and an idle sweep that fires in the middle of it
   * closes the pool under the running script. Take a lease for the duration
   * and release it in a `finally`.
   *
   * ```ts
   * const release = sessions.hold(id);
   * try { await agent.processRequest(message, signal); } finally { release(); }
   * ```
   *
   * Nested holds are counted, and releasing twice is a no-op.
   */
  hold(id: string): () => void;
  /**
   * Evict everything past its idle window, past `maxAgeMs`, or over `max`.
   *
   * Cheap, idempotent, and safe to call from every route — including
   * concurrently: an in-flight sweep is shared rather than duplicated, so two
   * requests can never both dispose the same session. Returns how many were
   * evicted.
   */
  reap(): Promise<number>;
  /** Evict one session now, waiting for its dispose. No-op if unknown. */
  end(id: string): Promise<boolean>;
  /** Evict everything — for a graceful process shutdown. */
  endAll(): Promise<void>;
  /** Live sessions, including ones still being created. */
  readonly size: number;
  /** The ids currently held, newest activity first. */
  ids(): string[];
}

interface Entry<S> {
  promise: Promise<S>;
  /** Resolved value, once `promise` settles — `peek` must not return a promise. */
  value?: S;
  createdAt: number;
  lastUsed: number;
  /** Open leases; a session with any is never evicted by a sweep. */
  held: number;
}

const DEFAULT_IDLE_MS = 30 * 60_000;

export function createSessionManager<S>(options: SessionManagerOptions<S>): SessionManager<S> {
  if (options.globalKey) {
    const slot = globalThis as Record<string, unknown>;
    const existing = slot[options.globalKey];
    if (existing) return existing as SessionManager<S>;
    const created = build(options);
    slot[options.globalKey] = created;
    return created;
  }
  return build(options);
}

function build<S>(options: SessionManagerOptions<S>): SessionManager<S> {
  const sessions = new Map<string, Entry<S>>();
  const now = options.now ?? (() => Date.now());
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const warn = options.onWarning ?? ((m: string) => console.warn(m));
  let sweeping: Promise<number> | null = null;

  const announce = (id: string, reason: Parameters<NonNullable<typeof options.onEvict>>[0]["reason"]) => {
    try {
      options.onEvict?.({ id, reason });
    } catch {
      // A host's telemetry must not be able to abandon a worker thread.
    }
  };

  /**
   * Remove the entry and dispose it.
   *
   * Removing FIRST is what makes concurrent eviction safe: the map is the
   * claim, so a second sweep (or an `end` racing a sweep) finds nothing and
   * cannot dispose the same session twice. Waits for the create to settle
   * before disposing — disposing a half-built session would leave whatever
   * `create` was still assembling unreleased.
   */
  const evict = async (id: string, entry: Entry<S>, reason: Parameters<typeof announce>[1]): Promise<void> => {
    if (sessions.get(id) !== entry) return;
    sessions.delete(id);
    announce(id, reason);
    let session: S;
    try {
      session = await entry.promise;
    } catch {
      return; // never created; there is nothing to release
    }
    try {
      await options.dispose(session, id);
    } catch (e) {
      warn(`session "${id}" failed to dispose: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const sweep = async (): Promise<number> => {
    const t = now();
    const doomed: Array<[string, Entry<S>, Parameters<typeof announce>[1]]> = [];
    for (const [id, entry] of sessions) {
      if (entry.held > 0) continue; // a turn is inside it
      if (idleMs > 0 && t - entry.lastUsed >= idleMs) doomed.push([id, entry, "idle"]);
      else if (options.maxAgeMs && t - entry.createdAt >= options.maxAgeMs) doomed.push([id, entry, "age"]);
    }
    for (const [id, entry, reason] of doomed) await evict(id, entry, reason);

    // Capacity last, and measured after the idle pass, so a sweep that already
    // freed room does not go on to drop live conversations.
    if (options.max && sessions.size > options.max) {
      const evictable = [...sessions.entries()]
        .filter(([, e]) => e.held === 0)
        .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
      for (const [id, entry] of evictable.slice(0, sessions.size - options.max)) {
        await evict(id, entry, "capacity");
        doomed.push([id, entry, "capacity"]);
      }
    }
    return doomed.length;
  };

  return {
    async get(id: string): Promise<S> {
      const existing = sessions.get(id);
      if (existing) {
        existing.lastUsed = now();
        return existing.promise;
      }
      // The promise goes into the map BEFORE it is awaited. Anything else and
      // two requests arriving together each build an environment, one of which
      // is orphaned with its worker thread alive and its close() never called.
      const entry: Entry<S> = { promise: null as never, createdAt: now(), lastUsed: now(), held: 0 };
      entry.promise = options.create(id).then(
        (session) => {
          entry.value = session;
          return session;
        },
        (e) => {
          // A failed create must not be remembered: a transient failure —
          // a cold model client, a full disk — would otherwise pin the id to
          // that error for the life of the process.
          if (sessions.get(id) === entry) sessions.delete(id);
          throw e;
        },
      );
      sessions.set(id, entry);
      return entry.promise;
    },

    peek(id: string): S | undefined {
      const entry = sessions.get(id);
      if (!entry) return undefined;
      entry.lastUsed = now();
      return entry.value;
    },

    hold(id: string): () => void {
      const entry = sessions.get(id);
      if (!entry) return () => {};
      entry.held += 1;
      entry.lastUsed = now();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        entry.held -= 1;
        entry.lastUsed = now();
      };
    },

    reap(): Promise<number> {
      // Shared rather than queued: reap is called from every route, and a
      // second sweep started 3ms after the first has nothing new to find.
      if (sweeping) return sweeping;
      sweeping = sweep().finally(() => {
        sweeping = null;
      });
      return sweeping;
    },

    async end(id: string): Promise<boolean> {
      const entry = sessions.get(id);
      if (!entry) return false;
      await evict(id, entry, "explicit");
      return true;
    },

    async endAll(): Promise<void> {
      await Promise.all([...sessions.entries()].map(([id, entry]) => evict(id, entry, "shutdown")));
    },

    get size(): number {
      return sessions.size;
    },

    ids(): string[] {
      return [...sessions.entries()].sort((a, b) => b[1].lastUsed - a[1].lastUsed).map(([id]) => id);
    },
  };
}
