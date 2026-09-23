import type { ExecutionConfig } from "station-daemon";

/** Private host connection. Never put this value in agent context or manifests. */
export interface FoundryStationConnection {
  readonly url: string;
  readonly stationId: string;
  readonly token: string;
}
export interface FoundryStationResources {
  readonly browser?: ExecutionConfig["browser"];
  readonly sandbox?: ExecutionConfig["sandbox"];
}
export interface FoundryStationDaemonOptions {
  /** Stable identity when exposing resource capabilities. */
  readonly stationId: string;
  readonly name?: string;
  /** Optional loopback port; omitted means an automatically allocated port. */
  readonly port?: number;
  /** Runs once inside the managed daemon, never during agent assembly. */
  readonly resources?: () => FoundryStationResources | Promise<FoundryStationResources>;
  /** Host-only callback after startup. The application owns connection storage. */
  readonly onReady?: (connection: FoundryStationConnection) => void | Promise<void>;
}
export interface FoundryStationDaemonAdapter {
  readonly kind: "station";
  readonly options: FoundryStationDaemonOptions;
}
/**
 * Configure the Station instance Foundry already owns. Provider adapters remain
 * application dependencies. Successfully returned resources belong to Station;
 * a factory that fails partway through acquisition must release its own resources.
 */
export function stationDaemon(options: FoundryStationDaemonOptions): FoundryStationDaemonAdapter {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(options.stationId)) throw new Error("A valid Station identity is required.");
  if (options.port !== undefined && (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535)) throw new Error("Station port must be between 1 and 65535.");
  return Object.freeze({ kind: "station", options: Object.freeze({ ...options }) });
}
