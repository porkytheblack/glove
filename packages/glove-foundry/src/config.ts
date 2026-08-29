/** Framework-level execution policy. The underlying runner is deliberately private. */
export interface FoundryExecutionConfig {
  readonly pollIntervalMs?: number;
  readonly idlePollIntervalMs?: number;
  readonly maxConcurrent?: number;
  readonly maxAttempts?: number;
  readonly retryBackoffMs?: number;
}

export interface FoundryConfig {
  readonly agentsDir?: string;
  readonly applicationFile?: string;
  readonly server?: {
    readonly host?: string;
    readonly port?: number;
  };
  readonly execution?: FoundryExecutionConfig;
  readonly observability?: {
    readonly maxEvents?: number;
  };
  readonly strictFileRoutes?: boolean;
}

type NoUnknownKeys<T, Shape> = T & Record<Exclude<keyof T, keyof Shape>, never>;

type ExactFoundryConfig<T extends FoundryConfig> = NoUnknownKeys<T, FoundryConfig> & {
  readonly server?: T["server"] extends object
    ? NoUnknownKeys<T["server"], NonNullable<FoundryConfig["server"]>>
    : T["server"];
  readonly execution?: T["execution"] extends object
    ? NoUnknownKeys<T["execution"], FoundryExecutionConfig>
    : T["execution"];
  readonly observability?: T["observability"] extends object
    ? NoUnknownKeys<T["observability"], NonNullable<FoundryConfig["observability"]>>
    : T["observability"];
};

export function defineConfig<const TConfig extends FoundryConfig>(
  config: ExactFoundryConfig<TConfig>,
): TConfig {
  return Object.freeze({ ...config });
}

export const DEFAULT_FOUNDRY_CONFIG = Object.freeze({
  agentsDir: "agents",
  applicationFile: "foundry.application.ts",
  server: { host: "127.0.0.1", port: 4141 },
  execution: {
    pollIntervalMs: 100,
    idlePollIntervalMs: 1_000,
    maxConcurrent: 5,
    maxAttempts: 1,
    retryBackoffMs: 1_000,
  },
  observability: { maxEvents: 10_000 },
  strictFileRoutes: true,
} as const satisfies FoundryConfig);
