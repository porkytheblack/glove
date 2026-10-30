import { join } from "node:path";
import { fileURLToPath } from "node:url";
export const dataDir = process.env.RESEARCH_DATA_DIR ?? fileURLToPath(new URL("../.data/", import.meta.url));
export const dataPath = (...parts: string[]) => join(dataDir, ...parts);
