import { Effect, JSONSchema, Schema } from "effect";
import type { AnyFoundryTransmission } from "./integration.js";

const JsonSchemaDocument = Schema.Record({
  key: Schema.String,
  value: Schema.Unknown,
});

export const FoundryManifestCapability = Schema.Struct({
  id: Schema.String,
  description: Schema.String,
  account: Schema.Literal("none", "optional", "required"),
  effect: Schema.Literal("read", "write"),
});

export const FoundryManifestTransmission = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  shape: Schema.Literal(
    "capability-only",
    "inbound-only",
    "outbound-only",
    "bidirectional",
  ),
  account: Schema.optional(
    Schema.Struct({
      required: Schema.Boolean,
      metadataSchema: JsonSchemaDocument,
    }),
  ),
  capabilities: Schema.Array(FoundryManifestCapability),
  inbound: Schema.optional(
    Schema.Struct({
      configSchema: JsonSchemaDocument,
      eventSchema: JsonSchemaDocument,
    }),
  ),
  outbound: Schema.optional(
    Schema.Struct({
      configSchema: JsonSchemaDocument,
      inputSchema: JsonSchemaDocument,
      outputSchema: JsonSchemaDocument,
    }),
  ),
});

export const FoundryApplicationManifest = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  generatedAt: Schema.String,
  transmissions: Schema.Array(FoundryManifestTransmission),
});
export type FoundryApplicationManifest =
  typeof FoundryApplicationManifest.Type;

export class ManifestCompilationError extends Schema.TaggedError<ManifestCompilationError>(
  "ManifestCompilationError",
)("ManifestCompilationError", {
  message: Schema.String,
}) {}

function shapeOf(
  definition: AnyFoundryTransmission,
): FoundryApplicationManifest["transmissions"][number]["shape"] {
  if (definition.inbound && definition.outbound) return "bidirectional";
  if (definition.inbound) return "inbound-only";
  if (definition.outbound) return "outbound-only";
  return "capability-only";
}

function jsonSchema(schema: Schema.Schema.AnyNoContext): Record<string, unknown> {
  return JSONSchema.make(schema) as unknown as Record<string, unknown>;
}

/** Compile code definitions into a value-only, credential-free manifest. */
export function compileApplicationManifest(
  transmissions: ReadonlyArray<AnyFoundryTransmission>,
): Effect.Effect<FoundryApplicationManifest, ManifestCompilationError> {
  return Effect.try({
    try: () => {
      const seen = new Set<string>();
      const compiled = [...transmissions]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((definition) => {
          if (seen.has(definition.id)) {
            throw new Error(`Duplicate integration id "${definition.id}".`);
          }
          seen.add(definition.id);
          return {
            id: definition.id,
            name: definition.name,
            description: definition.description,
            shape: shapeOf(definition),
            ...(definition.account
              ? {
                  account: {
                    required: definition.account.required,
                    metadataSchema: jsonSchema(definition.account.metadata),
                  },
                }
              : {}),
            capabilities: [...(definition.capabilities ?? [])],
            ...(definition.inbound
              ? {
                  inbound: {
                    configSchema: jsonSchema(definition.inbound.config),
                    eventSchema: jsonSchema(definition.inbound.event),
                  },
                }
              : {}),
            ...(definition.outbound
              ? {
                  outbound: {
                    configSchema: jsonSchema(definition.outbound.config),
                    inputSchema: jsonSchema(definition.outbound.input),
                    outputSchema: jsonSchema(definition.outbound.output),
                  },
                }
              : {}),
          } as const;
        });
      return Schema.decodeUnknownSync(FoundryApplicationManifest)({
        schemaVersion: 2,
        generatedAt: new Date().toISOString(),
        transmissions: compiled,
      });
    },
    catch: (cause) =>
      new ManifestCompilationError({
        message: cause instanceof Error ? cause.message : String(cause),
      }),
  }).pipe(
    Effect.withSpan("foundry.manifest.compile", {
      attributes: { "foundry.transmission.count": transmissions.length },
    }),
  );
}
