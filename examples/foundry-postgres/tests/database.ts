/**
 * A PostgreSQL database for one test file: a fresh database on DATABASE_URL's
 * server when that is set, otherwise a throwaway cluster started with the
 * local initdb/pg_ctl. Resolves null when neither is available.
 */
import { execFile } from "node:child_process";
import { chown, mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import pg from "pg";

const exec = promisify(execFile);

export interface TestDatabase {
  readonly url: string;
  stop(): Promise<void>;
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function binaries(): Promise<string | null> {
  try {
    const { stdout } = await exec("pg_config", ["--bindir"]);
    const dir = stdout.trim();
    if ((await readdir(dir)).includes("initdb")) return dir;
  } catch { /* look in the usual Debian location */ }
  try {
    const versions = (await readdir("/usr/lib/postgresql")).sort().reverse();
    for (const version of versions) {
      const dir = `/usr/lib/postgresql/${version}/bin`;
      if ((await readdir(dir)).includes("initdb")) return dir;
    }
  } catch { /* none */ }
  return null;
}

export async function startDatabase(): Promise<TestDatabase | null> {
  const external = process.env.DATABASE_URL;
  const name = `foundry_test_${process.pid}_${Date.now()}`;
  if (external) {
    const admin = new pg.Client({ connectionString: external });
    await admin.connect();
    await admin.query(`create database ${name}`);
    await admin.end();
    const url = new URL(external);
    url.pathname = `/${name}`;
    return {
      url: url.toString(),
      async stop() {
        const client = new pg.Client({ connectionString: external });
        await client.connect();
        await client.query(`drop database if exists ${name} with (force)`);
        await client.end();
      },
    };
  }
  const bin = await binaries();
  if (!bin) return null;
  const dir = await mkdtemp(join(tmpdir(), "foundry-postgres-"));
  // initdb refuses to run as root: run the cluster as the postgres user then.
  const asRoot = process.getuid?.() === 0;
  const command = async (file: string, args: string[]) => asRoot
    ? exec("runuser", ["-u", "postgres", "--", join(bin, file), ...args])
    : exec(join(bin, file), args);
  if (asRoot) {
    const { stdout } = await exec("id", ["-u", "postgres"]);
    const { stdout: group } = await exec("id", ["-g", "postgres"]);
    await chown(dir, Number(stdout.trim()), Number(group.trim()));
  }
  const data = join(dir, "data");
  await command("initdb", ["-D", data, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--no-sync"]);
  const port = await freePort();
  await command("pg_ctl", ["-D", data, "-l", join(dir, "server.log"), "-w", "-o", `-p ${port} -k ${dir} -c listen_addresses=127.0.0.1 -c fsync=off`, "start"]);
  return {
    url: `postgres://postgres@127.0.0.1:${port}/postgres`,
    async stop() {
      await command("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]).catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    },
  };
}
