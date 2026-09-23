/** Provider-neutral execution contract. Adapters validate inputs before effects. */
export interface ExecutionImage { mimeType: "image/png" | "image/jpeg"; base64: string }
export interface ExecutionResult {
  status: "success" | "error";
  data?: unknown;
  error?: { code: string; message: string; outcome?: "unknown" };
  images?: readonly ExecutionImage[];
}
export interface ExecutionOperation {
  /** Identifier inside browser.* or sandbox.*. */
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: unknown, options?: { signal?: AbortSignal }): Promise<ExecutionResult>;
}
/** A workflow-scoped capability grant, never a global worker administrator. */
export interface ExecutionAdapter {
  readonly name: string;
  readonly operations: readonly ExecutionOperation[];
  resourceIds(): string[];
  /** Uncertain creates must be reconciled by the host before further admission. */
  uncertainCreations(): number;
  /** Stop admission, settle in-flight work and release this scope. */
  close(): Promise<void>;
}
export interface BrowserAdapter extends ExecutionAdapter {}
export interface SandboxAdapter extends ExecutionAdapter {}
