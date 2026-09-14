/** Framework-level execution policy. The underlying runner is deliberately private. */
export interface FoundryExecutionConfig {
  readonly pollIntervalMs?: number;
  readonly idlePollIntervalMs?: number;
  readonly maxConcurrent?: number;
  readonly maxAttempts?: number;
  readonly retryBackoffMs?: number;
}

export interface FoundryBrandingConfig {
  /** Product name shown in the inspector shell. Defaults to Glove Foundry. */
  readonly name?: string;
  /** Compact product relationship shown beneath the name. */
  readonly label?: string;
  /** Browser-title suffix. Defaults to Inspector. */
  readonly descriptor?: string;
  /** Six-digit hexadecimal accent colour. */
  readonly accent?: string;
}

export interface FoundryConfig {
  readonly agentsDir?: string;
  readonly applicationFile?: string;
  readonly server?: {
    readonly host?: string;
    readonly port?: number;
    /** JSON request limit for message-bearing multimodal endpoints. */
    readonly messageBodyBytes?: number;
  };
  readonly execution?: FoundryExecutionConfig;
  readonly observability?: {
    readonly maxEvents?: number;
  };
  readonly branding?: FoundryBrandingConfig;
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
  readonly branding?: T["branding"] extends object
    ? NoUnknownKeys<T["branding"], FoundryBrandingConfig>
    : T["branding"];
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
