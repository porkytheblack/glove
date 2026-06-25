# glove-sql — SQL correctness audit

A 10-agent test team adversarially probed the engine across SQL dimensions
(aggregates, joins, subqueries, windows, set-ops, NULL/type semantics, the
scalar-function library, predicates/jsonb, CTEs/parser, and realistic analytical
queries), each running real queries and comparing to Postgres semantics, with an
adversarial verifier confirming every finding. **54 issues confirmed** (17 high,
28 medium, 9 low). This file tracks them.

## Fixed in this PR (`tests/sql-fixes.test.ts`)

- **DISTINCT inside aggregates** — `count/sum/avg(DISTINCT x)` were silently
  ignoring DISTINCT (returned the non-distinct value). Now deduped; composes with
  GROUP BY + FILTER.
- **ORDER BY after GROUP BY** sorted by misaligned pre-aggregation rows; now
  evaluates the sort key over each output row's group.
- **Three-valued NULL logic** — `=`/`<>`/arithmetic/`||` with a NULL operand now
  yield NULL (not false/NaN/`''`); `IN`/`NOT IN` honour NULL (`NOT IN (… NULL …)`
  → empty set).
- **jsonb/array/object equality** now compares by value, not JS reference.
- **CTE visibility** — CTEs are now visible inside scalar/IN/EXISTS subqueries
  (was a "relation does not exist" crash); `WITH … UNION …` applies CTEs to every
  branch (was silently ignored).
- **Scalar subquery cardinality** — a subquery returning >1 row now errors.
- **`%` modulo operator** added; **division/modulo by zero** raises a clear error.
- **Window functions over GROUP BY** now raise a clear error instead of crashing.

## Tracked (follow-ups)

### High
- [ ] Set-op precedence: `INTERSECT` should bind tighter than `UNION`/`EXCEPT`.
- [ ] Multiple unaliased output columns collide under the name `?column?`
      (breaks `UNION` dedup and column access). Make derived column names unique.

### Medium — correctness
- [ ] `ORDER BY … NULLS FIRST/LAST` parsed but ignored (also in window/set-op ORDER BY).
- [ ] `CAST(float AS int)` truncates instead of rounding to nearest.
- [ ] `CAST(int AS boolean)` maps only `1`→true (nonzero should be true).
- [ ] `round()` of negative half-values rounds toward zero, not away.
- [ ] `substr(s, start, len)` with `start < 1` returns too many chars.
- [ ] `trim/ltrim/rtrim` ignore the 2nd (character-set) argument.
- [ ] `sqrt`/`power` of negatives leak `NaN` (should error).
- [ ] Unquoted identifiers are case-sensitive (Postgres folds to lowercase).
- [ ] `->>` on a JSON object/array emits compact JSON, not Postgres' canonical text.
- [ ] `->` to a JSON `null` collapses to SQL NULL (so `IS NULL` is wrong).
- [ ] Set-op branches with mismatched column counts aren't validated.
- [ ] Number vs numeric-string ordering uses lexical compare.
- [ ] `SELECT *` over `RIGHT/FULL JOIN` with an empty left table drops left columns.
- [ ] `INTERSECT ALL` / `EXCEPT ALL` behave as DISTINCT (the `ALL` is ignored).

### Medium — gaps (feature additions)
- [ ] `string_agg` / `array_agg` / `bool_and` / `bool_or` aggregates.
- [ ] `JOIN … USING (col)`.
- [ ] CTE column-alias list `WITH cte(a, b) AS (…)`.
- [ ] Parenthesized `SELECT` branches in set operations.
- [ ] Window frame clauses `ROWS/RANGE BETWEEN … PRECEDING/FOLLOWING`.
- [ ] `substring(s FROM a FOR b)` / `position(sub IN str)` syntax.

### Won't-fix / limitation (documented)
- Integer division returns float — the engine erases int-vs-float at the value
  level, so it can't replicate Postgres's `int / int → int`.
- `SUM` over bigint loses precision above 2^53 (JS `number`).

### Low
- [ ] Negative array index after `->` (`-> -1`) throws a parse error.
- [ ] Unterminated quoted string / identifier / block comment accepted.
- [ ] Trailing comma in the SELECT list mis-parses.
- [ ] A non-`CROSS` JOIN with no `ON`/`USING` is treated as a cross join.
- [ ] Bare (non-grouped) column accepted in a GROUP BY query.
- [ ] Integer subscript via `->` on a JSON object.
