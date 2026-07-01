# glove-scratchpad ↔ Postgres Parity Audit

*Scope: the "database emulator" (`glove-scratchpad`) and its SQL engine (`glove-sql`) that expose an agent's capabilities as SQL tables over a single `execute_sql` tool. North star: to a capable SQL/Postgres-fluent coding agent ("droid"), it should feel like a real database. This audit catalogs the confirmed **parity gaps** that remain after the already-landed fixes (INSERT…SELECT dedupe, ephemeral-table teardown, IN-fanout, read-your-writes overlay, primed enum/required-key catalog hints, anti-spiral preamble).*

Every finding below was adversarially verified against source; each carries a `file:line`. Nothing here is speculative.

---

> ## ✅ Resolved in the parity pass (batches A–E)
>
> The bulk of this audit has since been implemented. All three cross-cutting root
> causes are closed, along with most individual gaps:
>
> - **Batch A — loud errors + idiom resolution** (`glove-sql`): boolean `= 'false'`
>   no longer inverted; `+`-on-text throws with a `||` hint; **unknown column throws**
>   (`column "x" does not exist`) instead of NULL; column/table refs resolve
>   case-insensitively; `current_date`/`current_timestamp` resolve; leading `public.`
>   strips; actionable "unexpected token"/ON CONFLICT messages; `table_type='BASE TABLE'`.
> - **Batch C — function library** (`glove-sql`): `string_agg`/`array_agg`/`json_agg`/
>   `bool_or`/`bool_and`; `date_trunc`/`date_part`/`EXTRACT(field FROM ts)`.
> - **Batch D — introspection** (`glove-sql` + `catalog.ts`): `information_schema.columns`
>   now exposes `is_nullable` (required keys) and `description` (enum values) — the
>   catalog boundary no longer drops metadata; keys/enums are SQL-discoverable.
> - **Batch B — RETURNING**: `INSERT/UPDATE/DELETE … RETURNING` on native tables;
>   virtual `INSERT … RETURNING` in the scratchpad (UPDATE/DELETE redirect to SELECT).
> - **Batch E — write safety** (`scratchpad`): transaction **auto-rollback on error**
>   (no cross-turn strand); capability errors list supported ops; **over-broad
>   UPDATE/DELETE** (range/OR/LIKE WHERE) is rejected, not silently widened.
>
> - **Batch F — idiom completeness sweep**: string library (`split_part`, `left`/
>   `right`, `lpad`, `concat_ws`, …), `to_char`/`make_date`, regex operators +
>   `regexp_replace`, `IS [NOT] DISTINCT FROM`, SQL-standard `substring`/`position`,
>   `interval` arithmetic, native `ON CONFLICT` upsert, `DISTINCT ON`; fixed
>   `ltrim`/`rtrim` silently ignoring their chars argument.
> - **Last-mile pass** (from the 3 residual weak-model failures — all platform
>   gaps, not capacity floors): write results carry the **row count** (`insert …
>   fired — 15 row(s)` — a model that saw `rows: []` reported "0 issues");
>   **`WITH … INSERT/UPDATE/DELETE`** (data-modifying CTE readers) parse and
>   resolve; `RETURNING` no longer eaten as an implicit alias; virtual
>   `INSERT…SELECT…RETURNING` works; a **0-row read carries a re-check nudge**;
>   BEGIN-wrapped SELECT scripts return their rows instead of discarding them.
>
> Engine tests: glove-sql **111/111**, glove-scratchpad **60/60**. The findings below
> are retained as the original audit record. Remaining (all loud errors, none
> silent): `SAVEPOINT`, window-frame exotica, `md5`/`regexp_matches`, a full
> `column_default` — none block the "feels like a database" bar.

---

> **Empirically re-verified.** After the agent audit, the headline engine claims were
> reproduced directly against `glove-sql` (MemoryBackend): `'a'+'b'` → `null`;
> `active = 'false'` matches the **true** rows (inverted); `SELECT ID`/`WHERE Name` →
> no match (case-sensitive identifiers); `current_date` → `null`; `SELECT nope FROM t` →
> `{nope:null}` (unknown column, no error); `string_agg`/`date_trunc`/`… RETURNING`
> all rejected. The "silently mis-answers instead of erroring" thesis holds.

## Summary

glove-scratchpad already clears a high bar: the hardened benchmark matrix sits near 97% pass and the worst historical traps are fixed. What remains are 27 confirmed gaps that share **one corrosive root pattern**: the emulator prefers to *silently mis-answer* rather than error the way Postgres does. The engine's own stated tenet is "anything outside the subset throws a clear error rather than silently mis-answering" (`packages/glove-sql/src/index.ts:18`) — yet a mistyped column, a `+`-on-text, a `= 'HIGH'`, a `= 'false'`, a bare `current_date`, or a forgotten `COMMIT` each return a confident wrong answer with no signal to self-correct.

The good news: the highest-leverage fixes are the cheapest. Restoring loud, Postgres-shaped errors and idiom resolution (identifier case-folding, `public.` stripping, `+`-on-text guard, boolean-literal coercion, actionable error messages, auto-rollback on batch error) is mostly S-effort and several are one-liners. The bigger bets are the missing aggregate/date-function library, the residual-double-filter case-sensitivity bug, and the write-path safety holes.

---

## Cross-cutting patterns (read these first)

Three root causes generate most of the individual gaps. Fixing the root is worth more than patching each symptom:

1. **`resolveColumn` returns `null` for anything absent, and equality re-runs case-sensitively.** The absent-column→NULL path (`index.ts:2197`) is the engine of *silent wrong answers*: unknown columns, un-folded identifiers, thin `information_schema` projections, and paren-less `current_date` all funnel through it and become NULL rather than an error.
2. **Metadata is dropped at the `catalog.ts` boundary.** `catalogTables()` maps every column to just `{name, type}` (`packages/glove-scratchpad/src/db/catalog.ts:36-41`), discarding `requiredKey` and `description` — the two facts a droid most needs. The engine's `CatalogTable` interface (`index.ts:1184-1187`) can't even receive them. This one boundary starves `information_schema`, kills SQL-native discovery of required keys and enum values, and forces everything out-of-band into the primed system-prompt hint.
3. **The write path never re-applies the residual WHERE, and pushes equalities twice.** `runWrite` pushes only equality/IN bindings to the resolver with no residual filter (`database.ts:560-582`), while `runRead` re-runs the *full original SQL text* as a residual pass (`database.ts:343`). The first causes over-broad writes; the second causes the case-sensitive double-filter (`'high' = 'HIGH'` → []).

---

## Theme 1 — Silent wrong answers (the anti-affordance root)

*The most corrosive class for the "real DB" illusion: there is no error to recover from.*

### 1.1 Unknown / misspelled column silently resolves to NULL — no error, no did-you-mean
- **DB expectation:** `ERROR: column "subjekt" does not exist` with a `HINT: Perhaps you meant … "subject"`.
- **Current behavior:** `resolveColumn` returns `null` for any column absent from every in-scope relation (`glove-sql index.ts:2189-2214`, fallthrough at `:2197`). A typo in a projection yields a column of NULLs; a typo in a WHERE yields `[]`. Asymmetric: INSERT/UPDATE *do* validate column existence (`index.ts:1360, 1422`) but SELECT does not. Contradicts the engine's own design claim at `index.ts:18`.
- **Fix:** Throw only at `resolveColumn`'s final fallthrough (`:2197`), **not** in `lookupColumn` (its `COLUMN_ABSENT` return is load-bearing for correlated outer scopes). Because empty relations skip the evaluator entirely, add a **bind-time validator** in `execSelect` checking every referenced column-expr against the union of in-scope schemas, throwing `column "X" does not exist` with a Levenshtein HINT. Skip `*`, `t.*`, and jsonb `->/->>` path keys.
- **Effort:** M · **Severity:** high · **Droid impact:** A single mistyped column produces a confidently-wrong answer the droid reports as fact — silent corruption of the agent's reasoning.

### 1.2 Unquoted identifiers not case-folded: `SELECT Id` → NULLs, `FROM Emails` → hard error
- **DB expectation:** Postgres folds unquoted identifiers to lowercase; `SELECT Id, Status FROM Emails` resolves and succeeds.
- **Current behavior:** Tokenizer preserves identifier case (`index.ts:179`); column resolution is exact-match (`:2204/:2211`) → `SELECT Id` yields all-NULL; table lookup is exact (`getTable` throws at `:1285`) → `FROM Emails` errors. Table *aliases* are folded (`:2206`), sharpening the inconsistency.
- **Fix (two independent halves):** (1) In the tokenizer word branch (`index.ts:176-181`) emit `value: …toLowerCase()` for unquoted idents, leaving the double-quoted branch (`:135-151`) untouched. Because keyword matching already lowercases (`:385`) and every physical name is already lowercase (`core/keys.ts:32`, materialize double-quotes on emit), this can only *fix* case-variant refs, never break one. (2) Land the absent-column throw from 1.1. Ship (1) first — it is self-contained and regression-free.
- **Effort:** M (half is S) · **Severity:** high · **Droid impact:** Models capitalize display names (`Id`, `Title`, `Status`) and get plausible NULL-filled results with no error.

### 1.3 `+` on text silently yields NaN → silent write corruption
- **DB expectation:** `operator does not exist: text + text`, nudging toward `||`.
- **Current behavior:** `evalBinary`'s `+` case is `num(l)+num(r)` via `Number()` (`index.ts:2265-2266`, `num()` at `:2540-2545`), so `'Verify: ' + title` → NaN → JSON-serializes to null and flows untyped through INSERT…SELECT into the underlying tool.
- **Evidence:** `logs/v4/minimax__compose-verify-issues__scratchpad.jsonl` — `'Verify: ' + title` → downstream `create_issue` `MCP error -32602 … expected string, received NaN`.
- **Fix:** In the `+` case (`:2265-2266`), if either operand is a non-numeric string whose `Number()` is NaN, throw `operator does not exist: text + text (hint: use || for string concatenation)`. Scope to `+` only.
- **Effort:** S · **Severity:** high · **Droid impact:** The worst failure mode — a silently corrupt write, surfacing only as an opaque downstream MCP type error.

### 1.4 Boolean = string comparison is INVERTED
- **DB expectation:** `WHERE active = 'f'` / `'false'` / `'no'` / `'0'` returns the FALSE rows.
- **Current behavior:** `looseEq`'s boolean branch is `Boolean(a) === Boolean(b)` (`index.ts:2552`). Every non-empty string is JS-truthy, so `active = 'false'` matches the **TRUE** rows and misses the false ones — the exact opposite set. Verified: rows id1=true,id2/id3=false → `= 'false'` returns `[{id:1}]`; keyword `= false` correctly returns `[2,3]`.
- **Fix:** In the boolean branch (`:2552`), when one operand is boolean and the other a string, parse the string as a Postgres bool literal (`t/true/y/yes/on/1` vs `f/false/n/no/off/0`) before comparing; unknown → false (or throw `invalid input syntax for type boolean`). Fixes `=`, `<>`, `IN`, and simple `CASE` at once (all funnel through `looseEq`).
- **Effort:** S · **Severity:** medium · **Droid impact:** Not just empty but *inverted* — the droid confidently reports the opposite population.

### 1.5 `current_date` / `current_timestamp` / `current_user` silently resolve to NULL
- **DB expectation:** Paren-less keyword date functions return today/now; `WHERE due < current_date` filters overdue rows.
- **Current behavior:** `parsePrimary` recognizes only `true/false/null`, then requires `(` for a call; a bare `current_date` becomes a column ref (`index.ts:1096-1103`) → NULL. `now()` (with parens) works, so `WHERE due < current_date` silently compares against NULL and returns zero rows. `applyScalarFunc` has only `now()` (`:2304`).
- **Fix:** In `parsePrimary` alongside the keyword handling (`:1015-1018`), map `current_timestamp`/`localtimestamp` → a `now` node, `current_date`/`current_time` → the date/time prefix of `now()`, and `current_user`/`session_user` → a stable placeholder role. Keep parenthesized forms symmetric in `applyScalarFunc`.
- **Effort:** S · **Severity:** high · **Droid impact:** Silent wrong answer — any idiomatic relative-date filter returns nothing and the droid trusts it.

### 1.6 Pushed-down equality re-applied case-sensitively — the `'HIGH'` vs `'high'` thrash
- **DB expectation:** A value is compared exactly once; if the capability matches case-insensitively (pagerduty does: `lc(i.urgency)===lc(a.urgency)`, `examples/scratchpad-bench/src/mcp/servers/pagerduty.ts:30`), the rows come back. No hidden second pass.
- **Current behavior:** The same `col = literal` is used BOTH as a resolver arg AND re-run verbatim as a residual filter — `runRead` executes `SELECT * FROM (<original text>) AS _q` (`database.ts:343`) over rows whose `urgency` is stored lowercase `'high'`; `looseEq`'s exact `a === b` (`index.ts:2561`) makes `'high' = 'HIGH'` false → every correctly-returned row is discarded → `[]`. `stampBindings` only fills NULL cells (`database.ts:445`), so it can't rescue rows already carrying `'high'`.
- **Evidence:** `logs/xiaomi__high-urgency-triggered__scratchpad.jsonl` runs ~20 `WHERE urgency = 'HIGH'` variants, all silently empty; glm/kimi/minimax repeat it.
- **Fix:** Strip the pushed-down single-valued `col = literal` equalities from the residual predicate before the re-run (rewrite the parsed AST and re-serialize rather than re-running raw `text`), so the resolver is the single source of truth — mirrors Postgres "compare once." **Critical nuance:** only strip equalities the resolver *actually consumed* (a resource's `args()` may ignore some declared columns, e.g. pagerduty forwards only status/urgency/service); limit stripping to columns genuinely passed to the tool. **Reject** the "case-fold residual text equality" alternative — text `=` is case-sensitive in real Postgres.
- **Effort:** M · **Severity:** high · **Droid impact:** The single most corrosive types/values failure: the capability *found* the data but the emulator hid it. One droid burned ~20 turns thrashing table names/quoting/UNION.

---

## Theme 2 — SQL-dialect / expression coverage

### 2.1 Missing aggregates (`array_agg`/`string_agg`/`json_agg`/`bool_or`/`bool_and`) — AND mis-reported as a GROUP BY error
- **DB expectation:** `SELECT count(*), array_agg(id) FROM t WHERE …` — valid Postgres needing no GROUP BY; the canonical "count AND list the ids."
- **Current behavior:** `AGG_FUNCS` holds only count/sum/avg/min/max (`index.ts:370`). Because `count(*)` puts the query in aggregate mode, `assertGrouped` doesn't recognize `array_agg`, recurses into its `id` arg, and throws the misleading `column "id" must appear in the GROUP BY clause` (`:1741-1746`). The droid adds a wrong GROUP BY, then hits `unsupported function 'array_agg()'` (`:2377`). **The first error a droid sees is a lie about the cause.**
- **Evidence:** `logs/v4/glm__high-urgency-triggered__…` (`STRING_AGG(id, ', ') … GROUP BY urgency` → GROUP BY error), `v4/xiaomi__compose-verify-issues__…` (`array_agg(number || ': ' || title)`); ~5 occurrences across glm/deepseek/xiaomi; glm answered **0**.
- **Fix:** Add the six names to `AGG_FUNCS` (`:370`) — this alone fixes the mis-reported GROUP BY error (`assertGrouped` case "func" returns instead of recursing) and routes `evalAggExpr` (`:2385`) to `aggregate()`. Implement in the `aggregate()` switch (`:2498-2513`). Caveats: `string_agg` has TWO args (value + delimiter) — join by the evaluated `args[1]`, don't collect it; `array_agg`/`json_agg` should preserve nulls (the collection loop currently skips them at `:2503`), whereas `string_agg`/`bool_or`/`bool_and` correctly ignore them.
- **Effort:** M · **Severity:** high · **Droid impact:** The single most-hit remaining aggregate gap; directly produced wrong answers.

### 2.2 Aggregate ORDER BY inside the call — `array_agg(id ORDER BY id)` — is a parse error
- **DB expectation:** The standard way to get a deterministic ordered list.
- **Current behavior:** The function-call arg parser accepts only DISTINCT + comma-separated exprs (`index.ts:1051-1057`); an in-call ORDER BY is unconsumed so `expectOp(')')` throws `expected ')' (near 'ORDER')`. (The ORDER BY parser at `:1079-1091` exists only inside `OVER(...)`.)
- **Evidence:** `logs/glm__high-urgency-triggered__…` — `ARRAY_AGG(id ORDER BY id)` → `expected ')' (near 'ORDER')` (2×).
- **Fix:** After the args loop (before `expectOp(")")` at `:1057`) accept an optional `ORDER BY <keys>` on the func node (reuse the `OrderKey[]` logic at `:1079-1091`); sort the per-group value list before folding. Ship together with 2.1.
- **Effort:** M · **Severity:** medium · **Droid impact:** The droid's natural deterministic form fails at parse before even reaching the unsupported-function error.

### 2.3 No date/time function library (`date_trunc`/`extract`/`to_char`/`date_part`/`interval`)
- **DB expectation:** `date_trunc('day', created_at)`, `extract(year FROM ts)`, `to_char(ts,'YYYY-MM')`, `WHERE ts > now() - interval '7 days'`.
- **Current behavior:** `applyScalarFunc` (`index.ts:2302-2378`) has only `now()`; the rest fall through to `unsupported function`. Worse, `extract(part FROM src)` fails to **parse** (the arg parser has no FROM-form, `:1051-1057`) → `expected ')' (near 'FROM')`; `interval '7 days'` parses `interval` as a column ref → `trailing tokens`. Note `now()` is a **logical clock** (`:1274-1277`), so `now() - interval` recency filters wouldn't match wall-clock data even if added.
- **Fix:** (a) Parser (`~1042-1057`): special-case `extract(<field> FROM <expr>)` and an `interval '<n> <unit>'` prefix. (b) Evaluator (`:2303` switch): add `date_trunc`/`date_part`/`extract`/`to_char`/`age` over ISO-string timestamps, plus timestamp±interval arithmetic. Scope the high-value pure functions over real `timestamptz` columns first; interval-with-now recency is lower priority (logical clock).
- **Effort:** L · **Severity:** medium · **Droid impact:** No observed log demand yet (synthetic probe), but any time-bucketing/recency work hits a mix of `unsupported function` and misleading parse errors.

### 2.4 Data-modifying leading CTE — `WITH x AS (…) INSERT INTO t SELECT … FROM x` — fails to parse
- **DB expectation:** Idiomatic "derive a row, then write it."
- **Current behavior:** `parseStatement` routes any leading WITH to `parseSelect` (`index.ts:417`), which expects SELECT → `expected 'SELECT' (near 'INSERT')`. (The reverse `INSERT … WITH … SELECT` works via `parseInsert` at `:591`.)
- **Evidence:** `logs/v3/kimi__email-top-error__…` — `WITH top_issue AS (…LIMIT 1) INSERT INTO emails … SELECT … FROM top_issue RETURNING …`.
- **Fix:** In `parseStatement` before the WITH→parseSelect route (`:417`), parse the CTE list, peek the next keyword, and if INSERT dispatch to `parseInsert` injecting the CTEs onto `asSelect.with` (the evaluator resolves CTEs only at `SelectStmt.with`). Limit execution to INSERT…SELECT (UPDATE/DELETE lack evaluator CTE support). The logged statement also needs RETURNING (§3-adjacent, tracked separately).
- **Effort:** M · **Severity:** medium · **Droid impact:** Observed once, but a common composition; the droid piled RETURNING on top, compounding the failure.

---

## Theme 3 — Write-path safety & semantics

### 3.1 UPDATE/DELETE silently drop every non-equality (and OR) WHERE predicate → over-broad, irreversible writes
- **DB expectation:** `DELETE FROM issues WHERE priority > 3` removes exactly the matching rows.
- **Current behavior:** `runWrite` builds resolver args purely from equality/IN bindings (`bindingsFor`→`extractEqualityBindings`) and passes ONLY those to `delete!`/`update!` — **no residual WHERE filtering on the write path** (`database.ts:560-582`; `extractEqualityBindings` at `index.ts:3009-3081` walks only AND-conjoined `col = lit` and `col IN (...)`). `>`, `<`, `IS NULL`, `LIKE`, ranges, and `OR` are dropped with no error. Probes: `DELETE … WHERE priority > 3` → empty bindings → deletes all; `WHERE status='open' AND priority>3` → only `{status:'open'}` pushed → deletes all open rows; `WHERE id='a' OR id='b'` → deletes all.
- **Fix:** (1) **Safety:** in `runWrite`, compute the dropped residual; if any remains, **refuse** the write with `predicate 'priority > 3' cannot be pushed to resource "issues"; refusing to avoid an over-broad write`. (2) Optionally, where the resource declares a key, materialize target rows (as `resolveReads` does), apply the full residual in-engine, and invoke `delete!`/`update!` with IN-bindings on the matched keys. At minimum surface a `droppedPredicate` warning in `explainStatement` (`database.ts:681-693`).
- **Effort:** M · **Severity:** high · **Droid impact:** The single most dangerous divergence — an ordinary bounded DELETE/UPDATE mutates the whole table, returns success, and (with immediate autocommit) is silent, unrecoverable blast-radius amplification.

### 3.2 RETURNING / ON CONFLICT / any trailing clause → dead-end "trailing tokens after statement"
- **DB expectation:** `INSERT … RETURNING id` (canonical read-back) or `INSERT … ON CONFLICT (id) DO NOTHING`; if malformed, Postgres names the exact token with a caret.
- **Current behavior:** `parseInsert`/`parseUpdate`/`parseDelete` stop after VALUES/SELECT/SET/WHERE; the leftover clause makes `parseSegment` throw a bare `MemoryBackend: trailing tokens after statement` (`index.ts:2857`) naming neither token nor cause — *less* location info than an ordinary parse error (the position-aware `err()` at `:411-414` is bypassed).
- **Evidence:** `logs/v4/minimax__compose-verify-issues__…` (`… SELECT … RETURNING number, title`, 2×); `logs/xiaomi__compose-verify-issues__…` lines 58/61/67 — hit 3× in a row, thrashed BEGIN/ROLLBACK/re-INSERT; **7 occurrences total**.
- **Fix:** In `parseSegment` (`:2854-2858`), surface the leftover token + position, and special-case: RETURNING → *"writes return a confirmation message; run a follow-up SELECT to read the row back"*; ON CONFLICT → *"upsert not supported — SELECT first, then INSERT or UPDATE."* Plumbing caveat: `err()`/`peek()` are private to `Parser` and `parseSegment` is module-level — add a small public accessor. (Fuller fix: actually parse-and-ignore RETURNING and echo the columns — larger.)
- **Effort:** S · **Severity:** high · **Droid impact:** Most-frequent opaque error in the latest runs; RETURNING is a reflex idiom; the message tells the model nothing to change so strong models thrash and weak ones abandon the write.

### 3.3 ON CONFLICT / upsert unsupported → opaque "trailing tokens"
- **DB expectation:** `INSERT … ON CONFLICT (col) DO NOTHING / DO UPDATE SET …` for idempotent retry-safe writes.
- **Current behavior:** `parseInsert` has no ON CONFLICT production (`index.ts:577-609`); clause left as trailing tokens.
- **Evidence:** `logs/xiaomi__compose-verify-issues__…` — droid hit PK conflicts ("1 of 15 inserts succeeded"), manually scanned for "safe unique numbers" — the exact workaround upsert removes.
- **Fix:** Add an ON CONFLICT production; map DO NOTHING to key-dedupe against the read-your-writes overlay, DO UPDATE to the update-resolver; where a resource can't express upsert, reject with a named error rather than the opaque message.
- **Effort:** M · **Severity:** medium · **Droid impact:** The idiomatic idempotent create is impossible, and because wrong inserts are often irreversible (§3.5), the natural defensive pattern is exactly the unavailable one.

### 3.4 Underlying resolver errors bleed through raw (MCP -32602 / Zod JSON / leaked tool name); INSERT has no not-null validation
- **DB expectation:** Omitting a required column → `ERROR: null value in column "repo" violates not-null constraint`. The droid was told its tables ARE the interface and it never sees underlying tools (`surface.ts:45-50`).
- **Current behavior:** No INSERT-time required-column concept (`requiredKey` gates only SELECT). An INSERT omitting `repo` passes the emulator and fails downstream; `resource.ts:203-204` throws the resolver's raw message, forwarded verbatim by `errResult` (`surface.ts:34-36`), so the droid sees `MCP error -32602: … tool create_issue: [{ "path": ["repo"], "message": "expected string, received undefined" }]` — leaking the internal tool name and Zod JSON. Same channel surfaces the §1.3 NaN.
- **Evidence:** `logs/v3/minimax__` and `v4/glm__compose-verify-issues__…` (omit `repo` → `received undefined`, 3×); `v4/minimax` (`'Verify: ' + title` → `received NaN`).
- **Fix:** (1) Not-null preflight in `insertRows` (`database.ts:609-643`): throw DB-shaped `null value in column "<col>" violates not-null constraint` (SQLSTATE 23502) before running the resolver. Prefer a **separate `requiredInsert` marker** on `ResourceColumn` (populated from the insert tool's schema) over overloading `requiredKey` (which conflates SELECT-pushdown keys with insert-required fields). (2) Normalize errors **at the resolver boundary** (`resource.ts:203-204` / the run() calls) — **not** in the generic `errResult`, which also carries legitimate parse/type errors that should reach the droid — re-emitting `ERROR: <table> rejected the write: <cleaned reason>` so the tool name never leaks.
- **Effort:** M · **Severity:** high · **Droid impact:** Recurs in every compose scenario across v3/v4; the off-model MCP/Zod payload can't be mapped back to "add the repo column."

### 3.5 Irreversible writes with no schema-level capability signal
- **DB expectation:** Introspect writable ops before acting (`information_schema.tables.is_insertable_into`, `table_privileges`); undo a wrong write with DELETE/UPDATE.
- **Current behavior:** A single INSERT fires immediately and irreversibly (`database.ts:603`). Insert-only resources reject DELETE/UPDATE only at runtime (`:551/561/573`). Up-front discovery is impossible: `catalogTables` emits only `{name, columns:{name,type}}` (`catalog.ts:36-41`), every resource is a generic `FOREIGN TABLE`, `is_insertable_into` resolves to silent NULL, and `table_privileges` doesn't exist.
- **Evidence:** `logs/v4/minimax__compose-verify-issues__…` — `DELETE FROM github_issues WHERE number IS NULL AND repo='acme/web'` (to undo a bad insert) → `is not deletable`.
- **Fix (three tiers):** (a) Annotate `catalogHint` (`mount.ts:33-42`) with per-op capability from wired verbs, e.g. `emails — INSERT only (irreversible; no UPDATE/DELETE)` — weak models read the primed hint, no engine change. (b) Add `is_insertable_into` to `INFO_TABLE_COLUMNS` (`index.ts:2534`) populated from whether `resource.insert` exists — kills the silent-null trap. (c) Optional: add `information_schema.table_privileges`. (Genuine gap is *introspection parity*, not literal undo — an outbound create/send is irreversible in real Postgres too.)
- **Effort:** M · **Severity:** medium · **Droid impact:** A droid fires an irreversible outbound write, then discovers only via a post-hoc runtime error that it can't undo it — the illusion breaks exactly when stakes are highest.

### 3.6 No command tag / affected-row count from a write
- **DB expectation:** `INSERT 0 1`, `UPDATE 3`, `DELETE 5`.
- **Current behavior:** `runWrite` returns `{ rows: [], message: 'update on "x" fired' }` with no count; the resolver's return from `staged.run(ctx)` is discarded (`database.ts:603` autocommit, `:301` COMMIT). `resource.insert/update/delete` are typed `Promise<unknown>` (`resource.ts:46-48`).
- **Fix:** Add `rowCount?: number` to `ExecuteResult`, surfaced via `surface.ts:62-72` with a PG-style tag in `message`. Sources in order of trust: INSERT → exact `rows.length` from `insertRows` (do unconditionally); UPDATE/DELETE → the resolver's returned count when present, else omit the number. **Do not** derive update/delete counts from the overlay via a speculative SELECT (adds a fetch, can be silently wrong for action-style resources).
- **Effort:** S · **Severity:** medium · **Droid impact:** A droid can't confirm mutation scope ("1 row or the whole table?") — compounds §3.1 by hiding the very count that would reveal the blast radius.

### 3.7 Capability-prohibition errors state a ban without reason or alternative
- **DB expectation:** A table you can INSERT into is one you can DELETE/UPDATE; genuine refusals explain the shape/reason.
- **Current behavior:** `relation "github_issues" is not deletable.` (and not insertable/updatable) — flat prohibition, no why, no alternative (`database.ts:551/561/573`).
- **Evidence:** `logs/v4/minimax__compose-verify-issues__…` line 37 — DELETE to undo a bad insert → `is not deletable`, stranded.
- **Fix:** Replace each bare throw with a message that names the append-only reason and lists supported ops, computed from `[resource.select&&'SELECT', …].filter(Boolean)`. Self-contained, no engine impact.
- **Effort:** S · **Severity:** medium · **Droid impact:** Strands the model precisely when it's recovering from its own mistake.

---

## Theme 4 — Transaction fidelity

### 4.1 A statement error inside a BEGIN…COMMIT script strands the transaction open across turns
- **DB expectation:** In psql, `BEGIN; <bad>; SELECT; COMMIT;` aborts the block and the trailing COMMIT rolls back; the next BEGIN just works.
- **Current behavior:** `execute()` runs statements in a bare loop and rethrows on first failure (`database.ts:280`) with no try/catch; `this.txn` clears only in commit/rollback handlers (`:298/:310`). A mid-script throw leaves `this.txn` set → the next `BEGIN` throws `a transaction is already open`.
- **Evidence:** `logs/deepseek__email-top-error__…` — `NOW()`-literal error, then next `BEGIN` → `a transaction is already open`, then a manual bare `ROLLBACK` (2 wasted turns).
- **Fix:** Wrap the runStatement loop (`:261-282`): on throw while a txn opened in-batch, drop `this.txn` before rethrowing (psql simple-query semantics). Minimal; guard with `!hadTxnBefore`.
- **Effort:** S · **Severity:** high · **Droid impact:** One bad statement poisons the whole session's transaction state, forcing the droid to guess it must send a bare ROLLBACK.

### 4.2 Interleaved SELECT in a txn returns nothing; staged writes invisible to in-txn reads
- **DB expectation:** A txn's own uncommitted changes are visible to later statements; each statement returns its own result. `BEGIN; INSERT; SELECT; COMMIT;` returns the inserted row.
- **Current behavior:** `execute()` returns only the LAST statement's result (`return last`, `database.ts:281`), so the interleaved SELECT's rows are dropped and the model gets COMMIT's empty result. Compounding: staged writes hit the overlay only at COMMIT/immediate-fire (`recordWrite` at `:302/:604`), never at stage time (`:599-601`), so even a SELECT that ran wouldn't see the staged INSERT.
- **Evidence:** `logs/kimi__email-top-error__…:18` (`{"rows":[],…,"committed":1}`); `logs/deepseek__email-top-error__…:24` ("I didn't get the SELECT result"). Two independent models.
- **Fix:** (1) In `execute()` (`:279-281`) return the last **non-txn-control** result (select/explain) if present, else the terminal result. (2) Have `applyOverlay` (`:491`) also fold `this.txn.writes` when a txn is open (discarded on ROLLBACK, already promoted on COMMIT). Reuses existing overlay machinery.
- **Effort:** M · **Severity:** medium · **Droid impact:** The canonical insert-then-verify idiom silently returns nothing; the write succeeds but the droid wastes turns re-querying.

### 4.3 Forgetting COMMIT silently loses staged writes — no persistent "pending writes" signal
- **DB expectation:** A forgotten COMMIT leaves the write visibly pending (and in real psql, rolled back on disconnect).
- **Current behavior:** A write inside an open txn is only STAGED with a soft `message: "staged insert on X"` (`database.ts:599-601`), fires only at COMMIT (`:295-305`); no reminder on subsequent `execute_sql`. `runRead` returns no `staged`/open-txn field.
- **Evidence:** `FINDINGS.md:135-137` — glm ran `BEGIN; INSERT … SELECT` and stopped without COMMIT; the staged write silently never fired (the single residual failure in the hardened matrix).
- **Fix (parity-preserving parts only):** (1) Make the staged message imperative (`:601`): `STAGED, NOT fired — send COMMIT to fire or ROLLBACK to discard (N pending)`. (2) Stamp `openTransaction: { stagedCount }` onto EVERY `ExecuteResult` while `this.txn !== null` (add to `runRead` at `:346` + explain), surfaced via `surface.ts`. **Drop** the "auto-commit"/"fire-on-session-end" ideas — they *diverge* from Postgres (which rolls back on disconnect) and would reduce parity. The preamble already steers away from lone-write BEGIN (`mount.ts:21`).
- **Effort:** M · **Severity:** medium · **Droid impact:** Droids wrap writes in BEGIN reflexively; a forgotten COMMIT reads as success but is silent data loss.

### 4.4 No SAVEPOINT / ROLLBACK TO / RELEASE — all-or-nothing, opaque failure
- **DB expectation:** Checkpoint with `SAVEPOINT sp1`, drop one bad write with `ROLLBACK TO sp1`.
- **Current behavior:** Parser recognizes only begin/commit/rollback (`index.ts:416-443`). `SAVEPOINT sp1` → `unsupported statement (near 'savepoint')`; `ROLLBACK TO sp1` matches the rollback branch, then chokes on `TO sp1` → `trailing tokens`.
- **Fix:** (1) Cheap: add parse cases for `savepoint`/`release`/`rollback to` that throw a **named** error ("a transaction is all-or-nothing; COMMIT or ROLLBACK the whole batch"). (2) Optional full support: model savepoints as markers in `Transaction.writes` (`savepoints: Map<string,number>`), ROLLBACK TO truncates, RELEASE drops the marker. Ship (1) now; (2) only if logs show demand (none observed).
- **Effort:** M · **Severity:** medium · **Droid impact:** No log evidence; an advanced idiom, so impact is inferred.

### 4.5 The documented "stage writes with BEGIN…COMMIT when writes disabled" workflow is unreachable
- **DB expectation (the emulator's own approval-gated design, `transaction.ts:1-8`):** with immediate writes off, the model still STAGES so a host can preview+approve; only COMMIT fires.
- **Current behavior:** `runWrite` checks `writesEnabled` and throws BEFORE the staging branch (`database.ts:539-544` vs `:599-601`). With the DEFAULT config (`policy.writes=false`), `BEGIN; INSERT; COMMIT` throws on the INSERT with a message recommending exactly what the droid just did ("wrap the write in BEGIN … COMMIT"). Nothing can ever be staged, defeating `preview()`. The doc (`surface.ts:20-22`, `database.ts:16`) describes the inverse of reality.
- **Fix:** (1) Cheap: when `writesEnabled` is false and a txn is open, drop the false escape-hatch message. (2) Design fix: move the `writesEnabled` gate off staging (`:539-544`) onto the FIRE paths only (immediate `:603`, COMMIT loop `:300-304`) so staging is reachable and COMMIT requires an explicit approval flag. Correct the docstrings.
- **Effort:** M · **Severity:** medium · **Droid impact:** Library-default only (the bench arm sets writes=true, masking it), but there it makes ALL writes impossible while telling the droid to retry the failing call.

---

## Theme 5 — Introspection / catalog parity

### 5.1 `information_schema.columns` silently returns NULL for `is_nullable` / `column_default`
- **DB expectation:** These columns exist; a droid probing "what must I supply on INSERT / what is nullable" trusts the answer.
- **Current behavior:** `infoSchemaColumnRows` emits only 6 keys (`index.ts:1910-1917, 1924-1932`); `INFO_COLUMNS` is that same list (`:2533`). Selecting `is_nullable`/`column_default` isn't an error — `resolveColumn` returns null (`:2197`) → status success with confidently-wrong NULL metadata.
- **Evidence:** `logs/minimax__compose-verify-issues__…:86` (`{is_nullable:null, column_default:null}` status success); deepseek/minimax across compose-verify-issues and email-top-error queried these to learn required columns.
- **Fix:** (1) Cheap safety net: projecting a standard-but-absent info-schema column should **raise** `column "is_nullable" does not exist` rather than null. (2) Better: populate them — `column_default` from `CatColumn.default` (`:59`); `is_nullable` needs `requiredKey` plumbed through `CatalogTable` (`:1184`) and `catalogTables()` (`catalog.ts:35-39`).
- **Effort:** M · **Severity:** high · **Droid impact:** Every column looked nullable with no default, so models omitted a required underlying-tool field on INSERT and hit an opaque MCP error — the exact discovery step feeding the compose-verify-issues failure chain.

### 5.2 `requiredKey` (the one fact a droid MUST know) is dropped at the catalog boundary and is nowhere queryable
- **DB expectation:** Discover keys/required columns via `key_column_usage`/`table_constraints`/`is_nullable` — never out-of-band. The tool description itself tells the droid to discover via `information_schema.columns` (`surface.ts:46-47`).
- **Current behavior:** `ResourceColumn.requiredKey` exists (`provider.ts:43`) but `catalogTables()` maps to only `{name,type}` (`catalog.ts:36-41`) and `CatalogTable` is `{name, columns:{name,type}}` (`index.ts:1184-1187`) — it never reaches `information_schema`. Surfaced only out-of-band: the primed hint (`mount.ts`), an explain warning that appears only AFTER omission (`database.ts:667-670`), or the runtime `requires an equality on X`. The preamble even redirects discovery to explain_sql (`mount.ts:18`).
- **Fix:** (a) Cheap/loose: thread `requiredKey`→`is_nullable='NO'` (caveat: NOT NULL ≠ "must appear in WHERE"). (b) Faithful: add an `information_schema.key_column_usage`/`table_constraints` view (net-new plumbing — only `.columns`/`.tables` are special-cased at `:789-800`).
- **Effort:** M · **Severity:** medium · **Droid impact:** A model whose context trimmed the hint has NO SQL way to recover the key; the discover-via-SQL contract is a dead end for its most important fact (though the runtime error does name the column, costing one turn).

### 5.3 No SQL-native way to discover a column's enum/allowed values
- **DB expectation:** `pg_enum`/`enum_range()`, `check_constraints`, `col_description()`; an invalid label raises `invalid input value for enum`.
- **Current behavior:** Authors put valid enum values in `ResourceColumn.description` (`mount.ts:30-32`; `pagerduty.ts:12-14`), but `catalogTables()` drops description (`catalog.ts:39`), `INFO_COLUMNS` has no description/domain/enum field (`index.ts:2533`), and there's no `pg_enum`/`check_constraints`/`col_description` anywhere. Values live only in the out-of-band `catalogHint`.
- **Evidence:** high-urgency logs across xiaomi/glm/kimi/minimax repeatedly guess `'HIGH'`; combined with §1.6 a wrong-case guess returns a silent empty set with no SQL path to self-correct.
- **Fix:** Thread `description` through `catalog.ts:39` → `CatalogTable` (`:1184`) → `INFO_COLUMNS`/`infoSchemaColumnRows` (`:2533`/`:1904-1935`) as a `column_comment` field (mirrors `col_description()`). A full `pg_enum` view is cleaner for muscle-memory but heavier; the engine has no type system to back it. Note: real Postgres enums also aren't in `information_schema.columns` (they're `USER-DEFINED` + `pg_enum`), so a `column_comment` is a pragmatic surface.
- **Effort:** M · **Severity:** low (partly mitigated — the hint is in the persistent system prompt) · **Droid impact:** A droid that reasonably re-queries for allowed values gets name+type only and guesses casing → silent `[]`.

### 5.4 Most catalog probes error `relation does not exist` — no routines/constraints/pg_catalog
- **DB expectation:** `information_schema.routines` (which functions exist — highly relevant since many aggregates/date funcs are unsupported), `table_constraints`/`key_column_usage`, `pg_catalog.pg_tables`, `pg_class`.
- **Current behavior:** `parseFromItem` special-cases ONLY `information_schema.columns`/`.tables` (`index.ts:797-802`); any other dotted catalog name is kept literal (`:803`) → `getTable` throws.
- **Evidence:** `logs/deepseek__email-top-error__…:62` — `SELECT routine_name, routine_type FROM information_schema.routines` → `relation "information_schema.routines" does not exist` (probing to discover a send-email function).
- **Fix:** Extend the dotted-name handling to materialize additional views via the existing infoschema mechanism (`:1831`). Highest value: `information_schema.routines` from the engine's known scalar+aggregate set (so a droid can *discover* that `array_agg`/`date_trunc` are unsupported). Add minimal `table_constraints`/`key_column_usage` and alias `pg_catalog.pg_tables`. (Drop psql `\d` — a client meta-command never sent over `execute_sql`.)
- **Effort:** L · **Severity:** medium · **Droid impact:** A droid reaching for standard catalog introspection hits a dead-end and burns turns; there's no SQL way to learn what functions the dialect supports.

### 5.5 `table_type='BASE TABLE'` returns zero rows — resource tables are `FOREIGN TABLE`
- **DB expectation:** The canonical `… WHERE table_type='BASE TABLE'` enumeration lists ordinary tables.
- **Current behavior:** `infoSchemaTableRows` emits every resource table as `FOREIGN TABLE` (`index.ts:1950-1957`); only materialized ephemerals get `BASE TABLE` (`:1941-1948`), usually none → the filter returns empty. (Also non-canonical: modern PG reports foreign tables as `FOREIGN`, not `FOREIGN TABLE`.)
- **Fix:** Emit `BASE TABLE` for resource/catalog tables (`:1956`) — they're read/write-visible via the overlay, so it's honest. One-line change; no consumer relies on the value.
- **Effort:** S · **Severity:** low · **Droid impact:** No observed failure (sampled droids used the schema-name filter); a droid using the textbook BASE-TABLE enumeration gets an empty catalog and may conclude the DB is empty.

### 5.6 Schema-qualified relation name errors with no hint to drop the qualifier
- **DB expectation:** `public.linear_issues` resolves via search_path; a wrong schema says `schema "public" does not exist`, not "opaque relation."
- **Current behavior:** `parseFromItem` keeps `public.linear_issues` as one literal name (`index.ts:789-803`) → `getTable` throws `relation "public.linear_issues" does not exist` (`:1285`), no hint. The preamble warns against schema-qualifying (`mount.ts:17`) — an admission the engine can't handle a standard form.
- **Evidence:** `logs/xiaomi__busiest-assignee__…` — `FROM public.linear_issues` → `relation "public.linear_issues" does not exist`.
- **Fix:** Strip a leading `public.` prefix in `parseFromItem` (`:789-803`), keeping the info-schema checks. Optionally add a `getTable` hint (`:1283-1287`): if the missing name is dotted and its suffix is a known table, `relation "<name>" does not exist — reference tables by bare name: <suffix>`.
- **Effort:** S · **Severity:** medium · **Droid impact:** Schema-qualifying is a reflex; the current error punishes it with a dead-end string, costing a rediscovery round-trip.

---

## Theme 6 — Enum-value discovery (types)

*(Overlaps §5.3; called out separately because the casing trap is the specific reason enum errors have no in-SQL escape hatch.)*

### 6.1 Enum-valued columns declared as bare `text` with no SQL-discoverable value set
- Same mechanism and fix as §5.3. The distinct impact: enum columns report `data_type='text'` with no hint of `high|low` / `triggered|acknowledged|resolved`; the labels live only in prose, and combined with case-sensitive equality (§1.6) a wrong-case guess is a silent empty set. `pagerduty.ts:14` declares labels only in `description`; `catalog.ts:39` + `index.ts:2533` drop them.
- **Effort:** M · **Severity:** medium.

---

## Prioritized roadmap

Ranked by (droid impact × frequency) / effort. "Quick wins" are S-effort, high-leverage; "big bets" are M/L with the highest impact.

| # | Gap | Theme | Effort | Severity | Freq (logs) | Primary anchor |
|---|-----|-------|--------|----------|-------------|----------------|
| 1 | `+` on text → NaN (silent corrupt write) | Silent-wrong | S | high | v4 minimax | `glove-sql index.ts:2265-2266` |
| 2 | Txn stranded open on mid-batch error | Transactions | S | high | deepseek | `database.ts:261-282` |
| 3 | "trailing tokens" dead-end (RETURNING/ON CONFLICT) | Errors | S | high | 7× | `index.ts:2854-2858` |
| 4 | `current_date`/`current_timestamp` → NULL | Silent-wrong | S | probe | high | `index.ts:1015-1018` |
| 5 | Case-fold unquoted identifiers | Silent-wrong | S/M | high | probe | `index.ts:176-181` |
| 6 | Boolean = string inverted | Types | S | medium | probe | `index.ts:2552` |
| 7 | Capability-ban error messages | Errors | S | medium | v4 minimax | `database.ts:551/561/573` |
| 8 | Strip `public.` qualifier | Introspection | S | medium | xiaomi | `index.ts:789-803` |
| 9 | Write command tag / row count | Write-path | S | medium | probe | `database.ts:601/603` |
| 10 | `table_type='BASE TABLE'` empty | Introspection | S | none | — | `index.ts:1956` |
| 11 | Unknown column → silent NULL | Silent-wrong | M | high | probe | `index.ts:2197` |
| 12 | `'HIGH'` vs `'high'` residual double-filter | Silent-wrong | M | high | ~20 turns | `database.ts:343` + `index.ts:2561` |
| 13 | array_agg/string_agg/… missing + misleading GROUP BY | SQL-dialect | M | high | ~5× | `index.ts:370` |
| 14 | Over-broad UPDATE/DELETE (dropped predicates) | Write-path | M | high | probe | `database.ts:560-582` |
| 15 | Leaked MCP/Zod errors + no INSERT not-null | Write-path | M | high | v3/v4 3× | `resource.ts:203-204` |
| 16 | `information_schema` silent-NULL is_nullable/default | Introspection | M | high | deepseek/minimax | `index.ts:2533` |
| 17 | Aggregate in-call ORDER BY parse error | SQL-dialect | M | medium | glm | `index.ts:1051-1057` |
| 18 | Data-modifying leading CTE parse fail | SQL-dialect | M | medium | v3 kimi | `index.ts:417` |
| 19 | Interleaved SELECT invisible in txn | Transactions | M | medium | kimi/deepseek | `database.ts:281` |
| 20 | Forgotten-COMMIT no persistent signal | Transactions | M | medium | 1× | `database.ts:599-601` |
| 21 | ON CONFLICT / upsert unsupported | Write-path | M | medium | xiaomi | `index.ts:577-609` |
| 22 | Irreversible-write capability signal | Write-path | M | medium | v4 minimax | `catalog.ts:36-41` |
| 23 | requiredKey dropped at catalog boundary | Introspection | M | medium | — | `catalog.ts:36-41` |
| 24 | Enum values not SQL-discoverable | Types | M | low/med | high-urgency | `catalog.ts:39` |
| 25 | Disabled-writes staging workflow unreachable | Transactions | M | medium | (default-only) | `database.ts:539-544` |
| 26 | SAVEPOINT / ROLLBACK TO unsupported | Transactions | M | none | — | `index.ts:416-443` |
| 27 | Date/time function library | SQL-dialect | L | medium | probe | `index.ts:2302-2378` |
| 28 | Catalog probes (routines/constraints) error | Introspection | L | medium | deepseek | `index.ts:797-803` |

---

## Quick wins (do these first)

These are S-effort, high-leverage, and several are one-liners. Together they knock out the loudest silent-wrong-answer and dead-end-error traps for a fraction of the total effort. Ship them as one PR:

1. **`+`-on-text guard** — `glove-sql index.ts:2265-2266`: throw `operator does not exist: text + text (hint: use || for string concatenation)`. Turns the worst failure (silent corrupt write) into an actionable error at the source.
2. **Case-fold unquoted identifiers** — `index.ts:176-181`: emit `toLowerCase()` for unquoted ident tokens. Physical names are already lowercase (`core/keys.ts:32`), so it can only fix `SELECT Id`/`FROM Emails`, never regress.
3. **Auto-rollback on mid-batch error** — wrap the `execute()` loop (`database.ts:261-282`) to drop `this.txn` on a throw while a txn opened in-batch. Matches psql; ends the "transaction already open" cross-turn poison.
4. **Paren-less date pseudo-functions** — `index.ts:1015-1018`: recognize `current_date`/`current_timestamp`/`current_user`. Ends the silent-NULL relative-date filter.
5. **Actionable "trailing tokens"** — `index.ts:2854-2858`: name the leftover token and special-case RETURNING / ON CONFLICT with a redirect. The most-frequent opaque error in recent runs.
6. **Boolean-literal coercion in `looseEq`** — `index.ts:2552`: parse string operands as PG booleans. Fixes the *inverted* `= 'false'` result across `=`/`<>`/`IN`/`CASE`.
7. **Enrich capability-ban messages** — `database.ts:551/561/573`: state the append-only reason and list supported ops.
8. **Strip `public.`** — `index.ts:789-803`: resolve `public.X` → `X` like search_path.
9. **`BASE TABLE` table_type** — `index.ts:1956`: one-line honesty fix for the canonical enumeration filter.

---

## Bigger bets (schedule after the quick wins)

- **Restore loud errors for unknown columns and thin `information_schema` projections** (§1.1, §5.1) — the highest-value structural change: a bind-time column validator plus raising on absent standard info-schema columns. This is the direct antidote to the cross-cutting "silent mis-answer" root and pairs naturally with identifier case-folding.
- **Kill the residual double-filter** (§1.6) — strip resolver-consumed equalities from the residual WHERE (AST rewrite + re-serialize), only for columns the `args()` fn actually consumed. Ends the single most turn-wasting types trap.
- **Aggregate + date/time function library** (§2.1–2.3, §2.4, §5.4) — add array_agg/string_agg/json_agg/bool_or (fixes the misleading GROUP BY error for free), aggregate in-call ORDER BY, and the date_trunc/extract/to_char/interval family. Surfacing these in `information_schema.routines` lets droids *discover* what's supported instead of trial-and-error.
- **Close the write-path safety holes** (§3.1, §3.4, §3.6) — refuse over-broad UPDATE/DELETE, add INSERT not-null validation with a `requiredInsert` marker, normalize leaked MCP/Zod errors at the resolver boundary, and return a command tag. These make writes feel like real, bounded, DB-shaped operations.
- **Thread `requiredKey` + `description` through the `catalog.ts` boundary** (§5.2, §5.3, §6.1) — one boundary change (`catalog.ts:36-41` + `CatalogTable` at `index.ts:1184-1187`) unlocks SQL-native discovery of both the load-bearing required-key fact and enum labels, retiring the reliance on the out-of-band primed hint.

---

## Note on what NOT to do

Two proposed directions would *reduce* parity and should be dropped:
- **Auto-commit / fire-on-session-end for forgotten COMMIT** (§4.3): real psql rolls back uncommitted writes on disconnect. Persistent pending-write *signalling* is the parity-faithful fix, not silent auto-fire.
- **Case-folding the residual text equality** (§1.6): text `=` is genuinely case-sensitive in Postgres. Strip the consumed conjunct instead.

*End of audit.*