import type { EnvTool, EnvToolResult, StdlibAdapter } from "../src/index";
import { createWorkingEnvironment, type WorkingEnvironment } from "../src/index";

export async function makeEnv(opts?: {
  stdlib?: StdlibAdapter[];
  limits?: Partial<import("../src/index").EnvLimits>;
}): Promise<WorkingEnvironment> {
  return createWorkingEnvironment({ stdlib: opts?.stdlib, limits: opts?.limits });
}

export function tool(env: WorkingEnvironment, name: string): EnvTool {
  const t = env.tools.find((t) => t.name === name);
  if (!t) throw new Error(`no tool named ${name}`);
  return t;
}

export async function call(env: WorkingEnvironment, name: string, input: unknown): Promise<EnvToolResult> {
  return tool(env, name).do(input);
}

/** Call a verb and assert success, returning data as text. */
export async function callOk(env: WorkingEnvironment, name: string, input: unknown): Promise<string> {
  const r = await call(env, name, input);
  if (r.status !== "success") throw new Error(`${name} failed: ${r.message}\n${r.data ?? ""}`);
  return String(r.data);
}

/** Call a verb and assert failure, returning the error message. */
export async function callErr(env: WorkingEnvironment, name: string, input: unknown): Promise<string> {
  const r = await call(env, name, input);
  if (r.status !== "error") throw new Error(`${name} unexpectedly succeeded: ${String(r.data)}`);
  return r.message ?? "";
}

export const VALID_SCRIPT = `/**
 * Adds two numbers from args.
 * @param {{ a: number, b: number }} args
 * @returns {Promise<{ sum: number }>}
 */
export default async function addNumbers(args) {
  return { sum: args.a + args.b };
}
`;
