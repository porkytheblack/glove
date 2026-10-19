/**
 * The backends every behavioural test runs on. Postgres joins when
 * MINIAPPS_TEST_DATABASE_URL points at a disposable database; each run gets
 * its own schema prefix so runs never see each other's apps.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { memoryBackend, type Backend } from "../src/index";
import { postgresBackend } from "../src/postgres";
import { sqliteBackend } from "../src/sqlite";

export interface BackendCase {
  name: string;
  make(): Promise<{ backend: Backend; reopen?: () => Backend; cleanup(): Promise<void> }>;
}

let n = 0;
const url = process.env.MINIAPPS_TEST_DATABASE_URL;

export const BACKENDS: BackendCase[] = [
  { name: "memory", make: async () => ({ backend: memoryBackend(), cleanup: async () => {} }) },
  { name: "sqlite :memory:", make: async () => ({ backend: sqliteBackend(), cleanup: async () => {} }) },
  {
    name: "sqlite files",
    make: async () => {
      const dir = mkdtempSync(join(tmpdir(), "miniapps-"));
      return {
        backend: sqliteBackend({ dir }),
        reopen: () => sqliteBackend({ dir }),
        cleanup: async () => rmSync(dir, { recursive: true, force: true }),
      };
    },
  },
  ...(url
    ? [
        {
          name: "postgres",
          make: async () => {
            const pool = new pg.Pool({ connectionString: url, max: 4 });
            const schemaPrefix = `t${process.pid}_${n++}_`;
            return {
              backend: postgresBackend({ pool, schemaPrefix }),
              reopen: () => postgresBackend({ pool, schemaPrefix }),
              cleanup: async () => {
                const { rows } = await pool.query(`SELECT nspname FROM pg_namespace WHERE nspname LIKE $1`, [`${schemaPrefix}%`]);
                for (const r of rows) await pool.query(`DROP SCHEMA "${r.nspname}" CASCADE`);
                await pool.end();
              },
            };
          },
        } satisfies BackendCase,
      ]
    : []),
];
