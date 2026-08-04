import type { EnvTool, EnvToolResult, StdlibAdapter } from "../src/index";
import { createWorkingEnvironment, type WorkingEnvironment } from "../src/index";

export async function makeEnv(opts?: {
  stdlib?: StdlibAdapter[];
  limits?: Partial<import("../src/index").EnvLimits>;
  execution?: import("../src/index").CreateWorkingEnvironmentOptions["execution"];
  requireDocsBeforeWrite?: boolean;
}): Promise<WorkingEnvironment> {
  return createWorkingEnvironment({ stdlib: opts?.stdlib, limits: opts?.limits, execution: opts?.execution, requireDocsBeforeWrite: opts?.requireDocsBeforeWrite });
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

let scriptCounter = 0;

/**
 * Write a script and run it, returning what its default export resolved to.
 * Throws with stderr attached on failure — a capability that misbehaves shows
 * up as a failed assertion rather than a silent `undefined`.
 */
export async function script<T = unknown>(env: WorkingEnvironment, source: string, args?: unknown): Promise<T> {
  const path = `/scripts/__t${++scriptCounter}.js`;
  await env.fs.writeFile(path, source);
  const run = await env.runScript(path, args ?? {});
  if (!run.ok) throw new Error(`script failed: ${run.error}${run.stderr ? `\nstderr:\n${run.stderr}` : ""}`);
  return run.result as T;
}

/** The same, but returns the error message instead of throwing. */
export async function scriptErr(env: WorkingEnvironment, source: string, args?: unknown): Promise<string> {
  const path = `/scripts/__t${++scriptCounter}.js`;
  try {
    await env.fs.writeFile(path, source);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  const run = await env.runScript(path, args ?? {});
  if (run.ok) throw new Error(`script unexpectedly succeeded: ${JSON.stringify(run.result)}`);
  return run.error ?? "";
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
