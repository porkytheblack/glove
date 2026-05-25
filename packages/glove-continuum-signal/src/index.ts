// ── Builder ────────────────────────────────────────────────────────────────
export {
  agent,
  AgentBuilder,
  TriggeredAgentBuilder,
  ConcurrentAgentBuilder,
  type Agent,
  type AnyAgent,
  type TriggeredAgent,
  type ConcurrentAgent,
  type AgentFactoryContext,
  type AgentRuntimeControls,
} from "./agent.js";

// ── Runner ────────────────────────────────────────────────────────────────
export {
  ContinuumRunner,
  type ContinuumRunnerOptions,
} from "./runner.js";

// ── Config (configure + global adapter) ───────────────────────────────────
export {
  configure,
  getAdapter,
  getTriggerAdapter,
  isConfigured,
  type ConfigureOptions,
} from "./config.js";

// ── Adapters ──────────────────────────────────────────────────────────────
export {
  type ContinuumAdapter,
  type SerializableAdapter,
  type AdapterManifest,
  isSerializableAdapter,
  MemoryAdapter,
  registerAdapter,
  createAdapter,
  hasAdapter,
  type TriggerAdapter,
  HttpTriggerAdapter,
  type HttpTriggerOptions,
} from "./adapters/index.js";

// ── Subscribers ───────────────────────────────────────────────────────────
export {
  type ContinuumSubscriber,
  type AgentEventEnvelope,
  ConsoleSubscriber,
} from "./subscribers/index.js";

// ── IPC ───────────────────────────────────────────────────────────────────
export {
  type ParentToChildMessage,
  type ChildToParentMessage,
  type IPCMessage,
} from "./ipc.js";

// ── Types ─────────────────────────────────────────────────────────────────
export {
  type AgentMode,
  type Run,
  type RunKind,
  type RunStatus,
  type RunPatch,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_MAX_CONCURRENT,
  DEFAULT_RETRY_BACKOFF_MS,
  DEFAULT_WARM_HEARTBEAT_MS,
  DEFAULT_WARM_RESTART_MAX,
  DEFAULT_WARM_RESTART_BACKOFF_MS,
} from "./types.js";

// ── Errors ────────────────────────────────────────────────────────────────
export {
  AgentValidationError,
  AgentNotFoundError,
  AgentTimeoutError,
  AgentTerminatedError,
  ContinuumRemoteError,
} from "./errors.js";

// ── Util / branding ───────────────────────────────────────────────────────
export { isAgent, AGENT_BRAND } from "./util.js";
export { parseInterval } from "./interval.js";

// ── Convenience re-exports ────────────────────────────────────────────────
export { z } from "zod";
export type {
  IGloveRunnable,
  StoreAdapter,
  SubscriberAdapter,
  SubscriberEvent,
  SubscriberEventDataMap,
} from "glove-core";
