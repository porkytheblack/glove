/**
 * The worked example the deploy tool shows the model. It lives in code, not
 * in prose, so the test suite deploys and calls it on every backend: the
 * example a model copies from is one that is known to work.
 */

import type { AppDefinition } from "./types";

export const EXAMPLE_APP: AppDefinition = {
  name: "habits",
  description: "Habits I'm tracking and the days I did them",
  schema: {
    checkins: {
      columns: {
        id: { type: "integer", primaryKey: true },
        habit: { type: "text" },
        day: { type: "text", description: "YYYY-MM-DD" },
        note: { type: "text", nullable: true },
      },
      indexes: [["habit", "day"]],
    },
  },
  methods: {
    check_in: {
      kind: "action",
      description: "Record a habit done on a day",
      params: {
        habit: { type: "string" },
        day: { type: "string", description: "YYYY-MM-DD" },
        note: { type: "string", optional: true },
      },
      sql: "INSERT INTO checkins (habit, day, note) VALUES (:habit, :day, :note) RETURNING id, habit, day",
      returns: "one",
      emits: "checked_in",
    },
    streak: {
      kind: "query",
      description: "How many days in a row a habit was done, ending today",
      params: { habit: { type: "string" } },
      js: [
        "const days = db.query({ sql: 'SELECT DISTINCT day FROM checkins WHERE habit = :habit ORDER BY day DESC', params: { habit: args.habit } }).map(r => r.day);",
        "let n = 0;",
        "let t = new Date(ctx.now.slice(0, 10)).getTime();",
        "for (const day of days) { if (day !== new Date(t).toISOString().slice(0, 10)) break; n++; t -= 86400000; }",
        "n",
      ].join(" "),
    },
  },
  outputs: {
    weekly: {
      description: "Days each habit was done in the last seven days",
      every: "7d",
      js: [
        "const since = new Date(new Date(ctx.now).getTime() - 6 * 86400000).toISOString().slice(0, 10);",
        "const rows = db.query({ sql: 'SELECT habit, count(DISTINCT day) AS days FROM checkins WHERE day >= :since GROUP BY habit ORDER BY habit', params: { since } });",
        "rows.length ? rows.map(r => '- ' + r.habit + ': ' + r.days + ' of 7 days').join('\\n') : 'Nothing checked in this week.'",
      ].join(" "),
    },
  },
};
