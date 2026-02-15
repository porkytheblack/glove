import Database from "better-sqlite3";
import type {
  StoreAdapter,
  Message,
  Task,
  TaskStatus,
  PermissionStatus,
} from "../core";

export interface SqliteStoreOptions {
  /** Path to the SQLite database file. Use ":memory:" for in-memory. */
  dbPath: string;
  /** Session identifier. Each session gets its own isolated data. */
  sessionId: string;
}

export class SqliteStore implements StoreAdapter {
  identifier: string;
  private db: Database.Database;

  constructor(opts: SqliteStoreOptions) {
    this.identifier = opts.sessionId;
    this.db = new Database(opts.dbPath);

    // Enable WAL mode for better concurrent read performance
    this.db.pragma("journal_mode = WAL");

    this.initSchema();
    this.migrateSchema();
    this.ensureSession();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        token_count INTEGER NOT NULL DEFAULT 0,
        turn_count  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS messages (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id  TEXT NOT NULL,
        sender      TEXT NOT NULL,
        msg_id      TEXT,
        text        TEXT NOT NULL,
        tool_results TEXT,
        tool_calls   TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(session_id)
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session
        ON messages(session_id);

      CREATE TABLE IF NOT EXISTS tasks (
        id          TEXT NOT NULL,
        session_id  TEXT NOT NULL,
        content     TEXT NOT NULL,
        active_form TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'pending',
        PRIMARY KEY (session_id, id),
        FOREIGN KEY (session_id) REFERENCES sessions(session_id)
      );

      CREATE TABLE IF NOT EXISTS permissions (
        session_id TEXT NOT NULL,
        tool_name  TEXT NOT NULL,
        status     TEXT NOT NULL DEFAULT 'unset',
        PRIMARY KEY (session_id, tool_name),
        FOREIGN KEY (session_id) REFERENCES sessions(session_id)
      );
    `);
  }

  private migrateSchema() {
    const columns = this.db
      .prepare("PRAGMA table_info(sessions)")
      .all() as Array<{ name: string }>;
    const names = new Set(columns.map((c) => c.name));

    if (!names.has("name")) {
      this.db.exec(
        "ALTER TABLE sessions ADD COLUMN name TEXT NOT NULL DEFAULT ''",
      );
    }
    if (!names.has("working_dir")) {
      this.db.exec(
        "ALTER TABLE sessions ADD COLUMN working_dir TEXT NOT NULL DEFAULT ''",
      );
    }
  }

  private ensureSession() {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO sessions (session_id) VALUES (?)`,
      )
      .run(this.identifier);
  }

  // ─── Messages ────────────────────────────────────────────────────────────

  async getMessages(): Promise<Array<Message>> {
    const rows = this.db
      .prepare(
        `SELECT sender, msg_id, text, tool_results, tool_calls
         FROM messages WHERE session_id = ? ORDER BY id`,
      )
      .all(this.identifier) as Array<{
      sender: string;
      msg_id: string | null;
      text: string;
      tool_results: string | null;
      tool_calls: string | null;
    }>;

    return rows.map((row) => {
      const msg: Message = {
        sender: row.sender as "user" | "agent",
        text: row.text,
      };
      if (row.msg_id) msg.id = row.msg_id;
      if (row.tool_results) msg.tool_results = JSON.parse(row.tool_results);
      if (row.tool_calls) msg.tool_calls = JSON.parse(row.tool_calls);
      return msg;
    });
  }

  async appendMessages(msgs: Array<Message>): Promise<void> {
    const insert = this.db.prepare(
      `INSERT INTO messages (session_id, sender, msg_id, text, tool_results, tool_calls)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    const tx = this.db.transaction((messages: Array<Message>) => {
      for (const msg of messages) {
        insert.run(
          this.identifier,
          msg.sender,
          msg.id ?? null,
          msg.text,
          msg.tool_results ? JSON.stringify(msg.tool_results) : null,
          msg.tool_calls ? JSON.stringify(msg.tool_calls) : null,
        );
      }
    });

    tx(msgs);
  }

  // ─── Token / Turn counts ─────────────────────────────────────────────────

  async getTokenCount(): Promise<number> {
    const row = this.db
      .prepare(`SELECT token_count FROM sessions WHERE session_id = ?`)
      .get(this.identifier) as { token_count: number } | undefined;
    return row?.token_count ?? 0;
  }

  async addTokens(count: number): Promise<void> {
    this.db
      .prepare(
        `UPDATE sessions SET token_count = token_count + ? WHERE session_id = ?`,
      )
      .run(count, this.identifier);
  }

  async getTurnCount(): Promise<number> {
    const row = this.db
      .prepare(`SELECT turn_count FROM sessions WHERE session_id = ?`)
      .get(this.identifier) as { turn_count: number } | undefined;
    return row?.turn_count ?? 0;
  }

  async incrementTurn(): Promise<void> {
    this.db
      .prepare(
        `UPDATE sessions SET turn_count = turn_count + 1 WHERE session_id = ?`,
      )
      .run(this.identifier);
  }

  // ─── Reset ───────────────────────────────────────────────────────────────

  async resetHistory(): Promise<void> {
    const tx = this.db.transaction(() => {
      this.db
        .prepare(`DELETE FROM messages WHERE session_id = ?`)
        .run(this.identifier);
      this.db
        .prepare(
          `UPDATE sessions SET token_count = 0 WHERE session_id = ?`,
        )
        .run(this.identifier);
    });
    tx();
  }

  // ─── Tasks ───────────────────────────────────────────────────────────────

  async getTasks(): Promise<Array<Task>> {
    const rows = this.db
      .prepare(
        `SELECT id, content, active_form, status
         FROM tasks WHERE session_id = ? ORDER BY rowid`,
      )
      .all(this.identifier) as Array<{
      id: string;
      content: string;
      active_form: string;
      status: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      content: row.content,
      activeForm: row.active_form,
      status: row.status as TaskStatus,
    }));
  }

  async addTasks(tasks: Array<Task>): Promise<void> {
    const tx = this.db.transaction((taskList: Array<Task>) => {
      // Replace all tasks for this session
      this.db
        .prepare(`DELETE FROM tasks WHERE session_id = ?`)
        .run(this.identifier);

      const insert = this.db.prepare(
        `INSERT INTO tasks (id, session_id, content, active_form, status)
         VALUES (?, ?, ?, ?, ?)`,
      );

      for (const task of taskList) {
        insert.run(
          task.id,
          this.identifier,
          task.content,
          task.activeForm,
          task.status,
        );
      }
    });

    tx(tasks);
  }

  async updateTask(
    taskId: string,
    updates: Partial<Pick<Task, "status" | "content" | "activeForm">>,
  ): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (updates.status !== undefined) {
      sets.push("status = ?");
      values.push(updates.status);
    }
    if (updates.content !== undefined) {
      sets.push("content = ?");
      values.push(updates.content);
    }
    if (updates.activeForm !== undefined) {
      sets.push("active_form = ?");
      values.push(updates.activeForm);
    }

    if (sets.length === 0) return;

    values.push(this.identifier, taskId);

    this.db
      .prepare(
        `UPDATE tasks SET ${sets.join(", ")} WHERE session_id = ? AND id = ?`,
      )
      .run(...values);
  }

  // ─── Permissions ─────────────────────────────────────────────────────────

  async getPermission(toolName: string): Promise<PermissionStatus> {
    const row = this.db
      .prepare(
        `SELECT status FROM permissions WHERE session_id = ? AND tool_name = ?`,
      )
      .get(this.identifier, toolName) as { status: string } | undefined;
    return (row?.status as PermissionStatus) ?? "unset";
  }

  async setPermission(
    toolName: string,
    status: PermissionStatus,
  ): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO permissions (session_id, tool_name, status) VALUES (?, ?, ?)
         ON CONFLICT (session_id, tool_name) DO UPDATE SET status = excluded.status`,
      )
      .run(this.identifier, toolName, status);
  }

  // ─── Session metadata ────────────────────────────────────────────────────

  getName(): string {
    const row = this.db
      .prepare(`SELECT name FROM sessions WHERE session_id = ?`)
      .get(this.identifier) as { name: string } | undefined;
    return row?.name ?? "";
  }

  setName(name: string): void {
    this.db
      .prepare(`UPDATE sessions SET name = ? WHERE session_id = ?`)
      .run(name, this.identifier);
  }

  getWorkingDir(): string {
    const row = this.db
      .prepare(`SELECT working_dir FROM sessions WHERE session_id = ?`)
      .get(this.identifier) as { working_dir: string } | undefined;
    return row?.working_dir ?? "";
  }

  setWorkingDir(dir: string): void {
    this.db
      .prepare(`UPDATE sessions SET working_dir = ? WHERE session_id = ?`)
      .run(dir, this.identifier);
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }

  // ─── Static helpers ──────────────────────────────────────────────────────

  /** List all sessions in the database. */
  static listSessions(
    dbPath: string,
  ): Array<{ sessionId: string; name: string; createdAt: string; workingDir: string }> {
    const db = new Database(dbPath, { readonly: true });
    try {
      // Table might not exist yet
      const tableExists = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'`,
        )
        .get();
      if (!tableExists) return [];

      // Check if new columns exist
      const columns = db
        .prepare("PRAGMA table_info(sessions)")
        .all() as Array<{ name: string }>;
      const colNames = new Set(columns.map((c) => c.name));
      const hasName = colNames.has("name");
      const hasDir = colNames.has("working_dir");

      const sql = `SELECT session_id, created_at${hasName ? ", name" : ""}${hasDir ? ", working_dir" : ""} FROM sessions ORDER BY created_at DESC`;
      const rows = db.prepare(sql).all() as Array<Record<string, string>>;
      return rows.map((r) => ({
        sessionId: r.session_id,
        name: r.name ?? "",
        createdAt: r.created_at,
        workingDir: r.working_dir ?? "",
      }));
    } finally {
      db.close();
    }
  }
}
