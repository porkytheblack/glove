import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Where this project keeps its state. `pnpm verify` points it at a temporary folder. */
export const dataDir = process.env.DOTS_DATA_DIR ?? fileURLToPath(new URL("../.data/", import.meta.url));

export function dataPath(...parts: string[]): string {
  return join(dataDir, ...parts);
}

/** Stand-in data for the sources a dot reads. */
export function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
}
