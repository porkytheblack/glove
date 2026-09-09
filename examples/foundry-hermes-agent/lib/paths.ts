import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Host-owned durable directory. Mount this path to persistent storage in production. */
export function hermesDataDirectory(): string {
  return resolve(
    process.env.HERMES_DATA_DIR?.trim() || resolve(projectRoot, ".data"),
  );
}
