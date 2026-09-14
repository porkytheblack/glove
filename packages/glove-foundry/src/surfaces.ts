import { Effect } from "effect";
import type {
  Message,
  IGloveRunnable,
  SubscriberAdapter,
} from "glove-core";
import { z } from "zod";
import type { FoundryMessageInput, FoundryRequest } from "./primitives.js";
import { fileIdentified } from "./identity.js";
import type {
  FoundryMountedRepl,
  FoundryVfsHandle,
} from "./workbench.js";
import type { WorkingEnvironment } from "glove-working-environment";

export const FOUNDRY_LAYER_BRAND = Symbol.for("glove-foundry-layer");
export const FOUNDRY_SUBSCRIBER_BRAND = Symbol.for(
  "glove-foundry-subscriber",
);

const SURFACE_ID = /^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*$/;

function assertSurfaceId(id: string, label: string): void {
  if (!SURFACE_ID.test(id)) {
    throw new Error(
      `Invalid Foundry ${label} id "${id}". Use lowercase path segments containing letters, digits, and hyphens.`,
    );
  }
}

export interface FoundrySurfaceContext<TInput = unknown> {
  readonly definitionId: string;
  readonly agentId: string;
  readonly conversationId: string;
  readonly workspaceId: string;
  readonly runId: string;
  readonly input: TInput;
  readonly request: FoundryRequest;
  readonly message: Message;
  readonly messageInput: FoundryMessageInput;
  readonly messageText: string;
  readonly history: ReadonlyArray<Message>;
  readonly messages: ReadonlyArray<Message>;
  readonly glove: IGloveRunnable;
  readonly workingEnvironment?: WorkingEnvironment;
  readonly vfs?: FoundryVfsHandle;
  readonly repl?: FoundryMountedRepl;
  readonly signal: AbortSignal;
  readonly emit: (event: { type: string; data?: unknown }) => void;
}

export type FoundrySurfaceCleanup = () =>
  | void
  | Promise<void>
  | Effect.Effect<void, unknown, never>;

export interface FoundryLayerOptions<TConfigSchema extends z.ZodType | undefined = undefined> {
  /** @deprecated File-routed definitions derive identity from their filename. */
  readonly id?: string;
  readonly description: string;
  readonly config?: TConfigSchema;
  /**
   * Mount any Glove-native package or application concern onto the compiled
   * runnable. Mesh, memory subagent composition, scratchpads, image surfaces,
   * voice bridges and future Glove packages all fit through this seam.
   */
  readonly setup: (
    context: FoundrySurfaceContext & {
      readonly config: TConfigSchema extends z.ZodType
        ? z.output<TConfigSchema>
        : unknown;
    },
  ) => Effect.Effect<void | FoundrySurfaceCleanup, unknown, never>;
}

export type FoundryLayer<TConfigSchema extends z.ZodType | undefined = undefined> =
  Readonly<FoundryLayerOptions<TConfigSchema>> & {
    readonly id: string;
    readonly [FOUNDRY_LAYER_BRAND]: true;
  };

export function defineLayer<
  TConfigSchema extends z.ZodType | undefined = undefined,
>(options: FoundryLayerOptions<TConfigSchema>): FoundryLayer<TConfigSchema> {
  if (options.id) assertSurfaceId(options.id, "layer");
  const { id, ...definition } = options;
  return Object.freeze(fileIdentified({
    ...definition,
    [FOUNDRY_LAYER_BRAND]: true as const,
  }, "layer", id));
}

export interface FoundryLayerReference<
  TLayer extends FoundryLayer<any> = FoundryLayer<any>,
> {
  readonly layer: TLayer;
  readonly config?: TLayer extends FoundryLayer<infer TSchema>
    ? TSchema extends z.ZodType ? z.input<TSchema> : never
    : never;
}

export type FoundryLayerSelection =
  | FoundryLayerReference<any>
  | FoundryLayer<any>;

/** Select a configured layer with schema-inferred input. */
export function configureLayer<TLayer extends FoundryLayer<any>>(
  layer: TLayer,
  config: FoundryLayerReference<TLayer>["config"],
): FoundryLayerReference<TLayer> {
  return Object.freeze({ layer, config });
}

export interface FoundrySubscriberOptions {
  /** @deprecated File-routed definitions derive identity from their filename. */
  readonly id?: string;
  readonly description: string;
  readonly create:
    | SubscriberAdapter
    | ((
        context: FoundrySurfaceContext,
      ) =>
        | SubscriberAdapter
        | Promise<SubscriberAdapter>
        | Effect.Effect<SubscriberAdapter, unknown, never>);
}

export type FoundrySubscriber = Readonly<FoundrySubscriberOptions> & {
  readonly id: string;
  readonly [FOUNDRY_SUBSCRIBER_BRAND]: true;
};

export function defineSubscriber(
  options: FoundrySubscriberOptions,
): FoundrySubscriber {
  if (options.id) assertSurfaceId(options.id, "subscriber");
  const { id, ...definition } = options;
  return Object.freeze(fileIdentified({
    ...definition,
    [FOUNDRY_SUBSCRIBER_BRAND]: true as const,
  }, "subscriber", id));
}

export type FoundrySubscriberSelection = FoundrySubscriber;

export interface FoundryNativeRegistry {
  readonly layers: ReadonlyArray<FoundryLayer<any>>;
  readonly subscribers: ReadonlyArray<FoundrySubscriber>;
}

export interface FoundryNativeManifestEntry {
  readonly id: string;
  readonly kind: "layer" | "subscriber";
  readonly description: string;
  readonly file?: string;
}

export interface FoundryNativeManifest {
  readonly layers: ReadonlyArray<FoundryNativeManifestEntry>;
  readonly subscribers: ReadonlyArray<FoundryNativeManifestEntry>;
}

export const EMPTY_NATIVE_REGISTRY: FoundryNativeRegistry = Object.freeze({
  layers: Object.freeze([]),
  subscribers: Object.freeze([]),
});

function indexById<T extends { readonly id: string }>(
  values: ReadonlyArray<T>,
  label: string,
): Map<string, T> {
  const indexed = new Map<string, T>();
  for (const value of values) {
    if (indexed.has(value.id)) {
      throw new Error(`Duplicate Foundry ${label} id "${value.id}".`);
    }
    indexed.set(value.id, value);
  }
  return indexed;
}

export async function mountFoundrySurfaces(options: {
  readonly registry: FoundryNativeRegistry;
  readonly layers?: ReadonlyArray<FoundryLayerSelection>;
  readonly subscribers?: ReadonlyArray<FoundrySubscriberSelection | SubscriberAdapter>;
  readonly context: FoundrySurfaceContext;
}): Promise<() => Promise<void>> {
  const layers = indexById(options.registry.layers, "layer");
  const subscribers = indexById(options.registry.subscribers, "subscriber");
  const cleanup: FoundrySurfaceCleanup[] = [];
  const disposeAll = async (): Promise<void> => {
    const failures: unknown[] = [];
    for (const dispose of cleanup.reverse()) {
      try {
        const result = dispose();
        if (Effect.isEffect(result)) await Effect.runPromise(result);
        else await Promise.resolve(result);
      } catch (cause) {
        failures.push(cause);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, "Foundry surface cleanup failed.");
    }
  };

  try {
    for (const selected of options.subscribers ?? []) {
      let definition = selected;
      if (
        typeof definition === "object" &&
        definition !== null &&
        FOUNDRY_SUBSCRIBER_BRAND in definition
      ) {
        const registered = subscribers.get(definition.id);
        if (!registered) {
          throw new Error(
            `Agent "${options.context.agentId}" references unknown subscriber "${definition.id}".`,
          );
        }
        definition = registered;
      }
      let subscriber: SubscriberAdapter;
      let subscriberId = "inline";
      if (
        typeof definition === "object" &&
        definition !== null &&
        (definition as Record<PropertyKey, unknown>)[
          FOUNDRY_SUBSCRIBER_BRAND
        ] === true
      ) {
        const foundrySubscriber = definition as FoundrySubscriber;
        const created =
          typeof foundrySubscriber.create === "function"
            ? foundrySubscriber.create(options.context)
            : foundrySubscriber.create;
        subscriber = Effect.isEffect(created)
          ? await Effect.runPromise(created)
          : await Promise.resolve(created);
        subscriberId = foundrySubscriber.id;
      } else {
        subscriber = definition as SubscriberAdapter;
      }
      options.context.glove.addSubscriber(subscriber);
      cleanup.push(() => options.context.glove.removeSubscriber(subscriber));
      options.context.emit({
        type: "foundry.subscriber.mounted",
        data: { id: subscriberId },
      });
    }

    for (const selected of options.layers ?? []) {
      const reference = FOUNDRY_LAYER_BRAND in selected
        ? { layer: selected }
        : selected;
      const definition = layers.get(reference.layer.id);
      if (!definition) {
        throw new Error(
          `Agent "${options.context.agentId}" references unknown layer "${reference.layer.id}".`,
        );
      }
      const referenceConfig =
        "config" in reference ? reference.config : undefined;
      const parsed = definition.config
        ? definition.config.safeParse(referenceConfig ?? {})
        : { success: true as const, data: referenceConfig };
      if (!parsed.success) {
        throw new Error(
          `Invalid config for layer "${definition.id}": ${parsed.error.message}`,
        );
      }
      const dispose = await Effect.runPromise(
        definition.setup({ ...options.context, config: parsed.data }),
      );
      if (dispose) cleanup.push(dispose);
      options.context.emit({
        type: "foundry.layer.mounted",
        data: { id: definition.id },
      });
    }
  } catch (cause) {
    try {
      await disposeAll();
    } catch (cleanupCause) {
      throw new AggregateError(
        [cause, cleanupCause],
        "Foundry surface mount and cleanup failed.",
      );
    }
    throw cause;
  }

  return disposeAll;
}

export function isFoundryLayer(value: unknown): value is FoundryLayer {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as Record<PropertyKey, unknown>)[FOUNDRY_LAYER_BRAND] === true,
  );
}

export function isFoundrySubscriber(
  value: unknown,
): value is FoundrySubscriber {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as Record<PropertyKey, unknown>)[FOUNDRY_SUBSCRIBER_BRAND] ===
        true,
  );
}
