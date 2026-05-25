import type { ContinuumAdapter } from "./adapters/index.js";
import { MemoryAdapter } from "./adapters/memory.js";
import type { TriggerAdapter } from "./adapters/trigger.js";
import { HttpTriggerAdapter } from "./adapters/http-trigger.js";

let _adapter: ContinuumAdapter = new MemoryAdapter();
let _triggerAdapter: TriggerAdapter | null = null;
let _configured = false;
let _warnedUnconfigured = false;

export interface ConfigureOptions {
  /** Local adapter for in-process run storage. */
  adapter?: ContinuumAdapter;
  /** Remote Continuum server endpoint (e.g. "https://continuum.example.com"). */
  endpoint?: string;
  /** API key for authenticating with the remote Continuum server. */
  apiKey?: string;
  /** Custom trigger adapter (advanced — overrides endpoint/apiKey). */
  triggerAdapter?: TriggerAdapter;
}

export function configure(options: ConfigureOptions): void {
  if (_configured) {
    console.warn(
      "[glove-continuum-signal] configure() called multiple times. The previous configuration will be replaced.",
    );
  }

  if (options.adapter) {
    _adapter = options.adapter;
  }

  // configure() semantics: each call fully replaces the trigger adapter.
  // If the caller doesn't supply one (no triggerAdapter, no endpoint), the
  // previous one must be cleared — otherwise switching from remote-trigger
  // mode back to local-only silently leaves `.trigger()` POSTing upstream.
  if (options.triggerAdapter) {
    _triggerAdapter = options.triggerAdapter;
  } else if (options.endpoint) {
    _triggerAdapter = new HttpTriggerAdapter({
      endpoint: options.endpoint,
      apiKey: options.apiKey,
    });
  } else {
    _triggerAdapter = null;
  }

  _configured = true;
}

function autoConfigureFromEnv(): void {
  if (_configured) return;
  const endpoint = process.env.CONTINUUM_ENDPOINT;
  const apiKey = process.env.CONTINUUM_API_KEY;
  if (endpoint) {
    configure({ endpoint, apiKey });
  }
}

export function getAdapter(): ContinuumAdapter {
  autoConfigureFromEnv();
  if (!_configured && !_warnedUnconfigured) {
    _warnedUnconfigured = true;
    console.warn(
      "[glove-continuum-signal] No adapter configured — using default MemoryAdapter. " +
        "Call configure({ adapter }) or pass an adapter to ContinuumRunner for persistent storage.",
    );
  }
  return _adapter;
}

export function getTriggerAdapter(): TriggerAdapter | null {
  autoConfigureFromEnv();
  return _triggerAdapter;
}

export function isConfigured(): boolean {
  return _configured;
}
