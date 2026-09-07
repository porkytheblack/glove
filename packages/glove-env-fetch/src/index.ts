import { randomUUID } from "node:crypto";
import { defineAdapter, normalizePath } from "glove-working-environment";
import type { SecretRef, SecretStore } from "glove-env-secret";
import { createPolicy, origin, type NetworkPolicy } from "./policy";
import { FETCH_DOCS, FETCH_TYPES } from "./docs";
import { prepareBody, type BodyOptions } from "./body";
import { withDeadline } from "./deadline";
export type { MultipartPart } from "./body";

export type { NetworkPolicy } from "./policy";

export interface RequestOptions extends BodyOptions {
  method?: string;
  /** Follow (default), return the redirect response, or reject redirects. */
  redirect?: "follow" | "manual" | "error";
  /** May shorten, but cannot exceed, the host timeout. */
  timeoutMs?: number;
  headers?: Record<string, string>;
  /** Response file. Omit for a generated /tmp/fetch/*.bin path. */
  output?: string;
  overwrite?: boolean;
  /** Host-configured credential alias, not a raw token. */
  credential?: string;
  /** Default false for request(); download()/upload() require a successful status. */
  throwOnHttpError?: boolean;
}

export type DownloadOptions = Pick<RequestOptions, "headers" | "credential" | "overwrite" | "redirect" | "timeoutMs">;
export type UploadOptions = DownloadOptions & Pick<RequestOptions, "method" | "output">;

export interface FetchResult {
  path: string;
  status: number;
  ok: boolean;
  bytes: number;
  contentType: string | null;
  /** Host-selected response headers. The defaults exclude Set-Cookie. */
  headers: Record<string, string>;
}

export interface Credential {
  /** Exact origins allowed to receive these headers. */
  origins: string[];
  headers: Record<string, string | { ref: SecretRef; prefix?: string }>;
}

export interface FetchOptions extends NetworkPolicy {
  /** Inject a transport for proxies, DNS/IP egress enforcement, tests, etc. */
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  /** Host lifetime/run cancellation, also enforced for injected transports. */
  signal?: AbortSignal;
  maxResponseBytes?: number;
  maxUploadBytes?: number;
  maxRedirects?: number;
  /** Response header names returned to scripts. Defaults to content metadata and retry-after. */
  responseHeaders?: string[];
  credentials?: Record<string, Credential>;
  secretStore?: Pick<SecretStore, "get">;
}

function positive(value: number, name: string, zero = false): number {
  if (!Number.isSafeInteger(value) || value < (zero ? 0 : 1)) throw new TypeError(`${name} must be a ${zero ? "non-negative" : "positive"} integer`);
  return value;
}

function validateOptions(opts: RequestOptions) {
  if (!opts || typeof opts !== "object" || Array.isArray(opts)) throw new TypeError("Request options must be an object");
  if (opts.method !== undefined && (typeof opts.method !== "string" || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(opts.method))) throw new Error("Invalid HTTP method");
  if (opts.redirect !== undefined && !["follow", "manual", "error"].includes(opts.redirect)) throw new Error("Invalid redirect mode");
  if (opts.timeoutMs !== undefined) positive(opts.timeoutMs, "timeoutMs");
  for (const key of ["overwrite", "throwOnHttpError"] as const) {
    if (opts[key] !== undefined && typeof opts[key] !== "boolean") throw new TypeError(`${key} must be a boolean`);
  }
  if (opts.headers !== undefined && (!opts.headers || typeof opts.headers !== "object" || Array.isArray(opts.headers))) throw new Error("Request headers must be a record");
}

async function cancel(response: Response) {
  try { await response.body?.cancel(); } catch { /* best-effort cleanup */ }
}

/** Mounting this adapter explicitly grants network access under the supplied policy. */
export function fetchFiles(options: FetchOptions = {}) {
  const authorize = createPolicy(options);
  const timeoutMs = positive(options.timeoutMs ?? 30_000, "timeoutMs");
  if (timeoutMs > 2_147_483_647) throw new TypeError("timeoutMs exceeds the platform timer limit");
  const responseLimit = positive(options.maxResponseBytes ?? 32 * 1024 * 1024, "maxResponseBytes");
  const uploadLimit = positive(options.maxUploadBytes ?? 32 * 1024 * 1024, "maxUploadBytes");
  const redirects = positive(options.maxRedirects ?? 5, "maxRedirects", true);
  const responseHeaders = [...(options.responseHeaders ?? ["content-type", "content-length", "content-encoding", "last-modified", "retry-after"])];
  for (const header of responseHeaders) {
    if (typeof header !== "string") throw new TypeError("responseHeaders must contain header names");
    try { new Headers().set(header, "test"); } catch { throw new TypeError("Invalid response header name"); }
  }
  const transport = options.fetch ?? globalThis.fetch.bind(globalThis);
  const credentials = new Map(Object.entries(options.credentials ?? {}).map(([name, c]) => [name, {
    origins: c.origins.map(origin), headers: { ...c.headers },
  }]));

  return defineAdapter({
    name: "fetch",
    description: "HTTP requests, downloads and uploads using VFS paths and host-controlled network policy.",
    types: FETCH_TYPES,
    docs: FETCH_DOCS,
    create(vfs, ctx) {
      const pendingOutputs = new Set<string>();
      const request = async (input: string, opts: RequestOptions = {}): Promise<FetchResult> => {
        if (ctx.readOnly) throw new Error("HTTP requests are unavailable during script validation; call inside the default export");
        validateOptions(opts);
        const rawMethod = opts.method ?? "GET";
        const upper = rawMethod.toUpperCase();
        if (["CONNECT", "TRACE", "TRACK"].includes(upper)) throw new Error("This HTTP method is not supported by fetch");
        const method = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(upper) ? upper : rawMethod;
        const output = normalizePath(opts.output ?? `/tmp/fetch/${randomUUID()}.bin`);
        if (pendingOutputs.has(output)) throw new Error("Another request is already writing this output path");
        pendingOutputs.add(output);
        try {
          return await withDeadline(Math.min(timeoutMs, opts.timeoutMs ?? timeoutMs), options.signal, async (signal, commit) => {
            let url = await authorize(input, method);
            if (signal.aborted) throw new Error("HTTP request aborted");
            const initialOrigin = url.origin;
            if (!opts.overwrite && await vfs.exists(output)) throw new Error("Response output already exists; choose a new path or set overwrite");
            const maxBytes = Math.min(responseLimit, vfs.limits.maxFileBytes, vfs.limits.maxVfsBytes);
            const headers = new Headers();
            try {
              for (const [name, value] of Object.entries(opts.headers ?? {})) {
                if (typeof value !== "string") throw new Error();
                headers.set(name, value);
              }
            } catch { throw new Error("Invalid request headers"); }
            // Transport-owned headers cannot redirect a request or lie about its size.
            for (const name of ["host", "content-length", "connection", "transfer-encoding", "proxy-authorization"]) {
              if (headers.has(name)) throw new Error("Request contains a transport-controlled header");
            }
            const body = await prepareBody(opts, vfs, headers, Math.min(uploadLimit, vfs.limits.maxFileBytes));
            if ((method === "GET" || method === "HEAD") && body !== undefined) throw new Error("GET and HEAD cannot have a request body");
            if (signal.aborted) throw new Error("HTTP request aborted");
            const credential = opts.credential === undefined ? undefined : credentials.get(opts.credential);
            if (opts.credential !== undefined && (!credential || !credential.origins.includes(initialOrigin))) {
              throw new Error("Credential alias is unknown or not authorized for this origin");
            }
            if (credential) {
              try {
                for (const [name, value] of Object.entries(credential.headers)) {
                  if (typeof value === "string") headers.set(name, value);
                  else {
                    if (value.ref?.kind !== "env:secret" || !options.secretStore) throw new Error();
                    const secret = await options.secretStore.get(value.ref.name);
                    if (signal.aborted || typeof secret !== "string") throw new Error();
                    headers.set(name, (value.prefix ?? "") + secret);
                  }
                }
              } catch { throw new Error("Could not resolve configured request credentials"); }
            }

            let currentMethod = method;
            let currentBody = body;
            let currentHeaders = headers;
            for (let hop = 0; ; hop++) {
              if (signal.aborted) throw new Error("HTTP request timed out");
              let response: Response;
              try {
                response = await transport(url.href, {
                  method: currentMethod, headers: currentHeaders, body: currentBody as BodyInit | undefined,
                  redirect: "manual", signal,
                });
              } catch { throw new Error(signal.aborted ? "HTTP request timed out" : "HTTP transport failed"); }
              if (signal.aborted) { await cancel(response); throw new Error("HTTP request timed out"); }
              if (response.redirected) { await cancel(response); throw new Error("Transport must honor manual redirects"); }
              const redirectResponse = [301, 302, 303, 307, 308].includes(response.status) && response.headers.has("location");
              if (redirectResponse && opts.redirect === "error") {
                await cancel(response); throw new Error("HTTP redirect refused by request policy");
              }
              if (redirectResponse && opts.redirect !== "manual") {
                const location = response.headers.get("location")!;
                const status = response.status;
                await cancel(response);
                if (hop >= redirects) throw new Error("HTTP redirect limit exceeded");
                if ((status === 303 && currentMethod !== "HEAD") || ((status === 301 || status === 302) && currentMethod === "POST")) {
                  currentMethod = "GET"; currentBody = undefined;
                  currentHeaders.delete("content-type"); currentHeaders.delete("content-encoding");
                }
                let target: string;
                try { target = new URL(location, url).href; } catch { throw new Error("Invalid HTTP redirect"); }
                const next = await authorize(target, currentMethod);
                if (next.origin !== url.origin) {
                  if (currentBody !== undefined) throw new Error("Refusing to forward a request body across origins on redirect");
                  currentHeaders = new Headers();
                }
                url = next;
                continue;
              }
              if (opts.throwOnHttpError && !response.ok) {
                await cancel(response);
                throw new Error(`HTTP request failed with status ${response.status}`);
              }
              const declared = response.headers.get("content-length");
              if (currentMethod !== "HEAD" && declared && Number(declared) > maxBytes) {
                await cancel(response); throw new Error("HTTP response exceeds the size limit");
              }
              const chunks: Uint8Array[] = [];
              let bytes = 0;
              const reader = response.body?.getReader();
              const abortRead = () => { void reader?.cancel().catch(() => {}); };
              signal.addEventListener("abort", abortRead, { once: true });
              try {
                if (reader) while (true) {
                  const part = await reader.read();
                  if (part.done) break;
                  bytes += part.value.byteLength;
                  if (bytes > maxBytes) throw new Error("HTTP response exceeds the size limit");
                  chunks.push(new Uint8Array(part.value));
                }
              } catch {
                try { await reader?.cancel(); } catch { /* cleanup */ }
                throw new Error(bytes > maxBytes ? "HTTP response exceeds the size limit" : "HTTP response body could not be read");
              } finally {
                signal.removeEventListener("abort", abortRead);
                reader?.releaseLock();
              }
              if (signal.aborted) throw new Error("HTTP request timed out");
              const data = new Uint8Array(bytes);
              let offset = 0;
              for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
              if (!opts.overwrite && await vfs.exists(output)) throw new Error("Response output already exists");
              if (signal.aborted) throw new Error("HTTP request timed out");
              commit();
              await vfs.writeFile(output, data);
              const returnedHeaders: Record<string, string> = {};
              for (const name of responseHeaders) {
                const value = response.headers.get(name);
                if (value !== null) returnedHeaders[name] = value;
              }
              return { path: output, status: response.status, ok: response.ok, bytes,
                contentType: response.headers.get("content-type"), headers: returnedHeaders };
            }
          });
        } finally { pendingOutputs.delete(output); }
      };
      return {
        request,
        async download(url: string, output: string, opts: DownloadOptions = {}) {
          validateOptions(opts);
          return request(url, { headers: opts.headers, credential: opts.credential, overwrite: opts.overwrite,
            redirect: opts.redirect, timeoutMs: opts.timeoutMs, method: "GET", output, throwOnHttpError: true });
        },
        async upload(input: string, url: string, opts: UploadOptions = {}) {
          validateOptions(opts);
          return request(url, { headers: opts.headers, credential: opts.credential, overwrite: opts.overwrite,
            redirect: opts.redirect, timeoutMs: opts.timeoutMs, output: opts.output, method: opts.method ?? "PUT", bodyPath: input, throwOnHttpError: true });
        },
      };
    },
  });
}

export default fetchFiles;
