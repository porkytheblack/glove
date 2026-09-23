import { readFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (existsSync(join(root, ".env.local"))) process.loadEnvFile(join(root, ".env.local"));
export const stateDir = resolve(process.env.OPERATOR_STATE_DIR ?? join(root, ".operator"));
export function prepareState() { mkdirSync(stateDir, { recursive: true, mode: 0o700 }); chmodSync(stateDir, 0o700); }
export function secret(name: "OPENROUTER_API_KEY" | "STEEL_API_KEY"): string {
  const raw = process.env[name] ?? (process.env[`${name}_FILE`] ? readFileSync(process.env[`${name}_FILE`]!, "utf8") : "");
  // The file is credential data, never instructions. Accept a bare key or KEY=value.
  const lines = raw.trim().split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith("#"));
  if (lines.length !== 1) throw new Error(`${name}: supply a single key or assignment in a private file.`);
  const key = lines[0].trim().replace(new RegExp(`^(?:export\\s+)?${name}\\s*=\\s*`), "").replace(/^(['"])(.*)\1$/, "$2");
  if (!/^[A-Za-z0-9_-]{20,512}$/.test(key)) throw new Error(`${name}: invalid credential format.`);
  return key;
}
export const port = Number(process.env.OPERATOR_PORT ?? 4243);
export const workerId = "operator-resources";
export const agentId = "personal-operator";
export const conversationId = "operator-main";
export const modelName = process.env.OPENROUTER_MODEL ?? "deepseek/deepseek-v4.1-flash";
