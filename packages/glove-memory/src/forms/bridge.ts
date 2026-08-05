import type { Provenance } from "../core/provenance";
import type { EntityMemoryAdapter } from "../entity/adapter";
import type { EdgeWriteResult, NodeWriteResult } from "../entity/types";
import type { EpisodicMemoryAdapter } from "../episodic/adapter";
import type { ResourceFsAdapter } from "../resources/adapter";
import type { ResourceBody, ResourceMetadata } from "../resources/types";
import type { ContextAdapter } from "../context/adapter";
import type { ContextEntryInput } from "../context/types";

/**
 * The four memory subsystems, as an executor sees them.
 *
 * Every method is always present; a method whose subsystem wasn't wired into
 * the runner throws. That is deliberate — `ctx.memory.upsertNode(...)` with
 * no optional chaining reads the way the design doc writes it, and a form
 * that quietly skipped its writes because an adapter was missing is a worse
 * failure than one that stops.
 *
 * Provenance is supplied by the engine, not the executor: every write carries
 * the instance and hook that caused it.
 */
export interface FormMemoryBridge {
  upsertNode(
    className: string,
    props: Record<string, unknown>,
  ): Promise<NodeWriteResult>;

  connect(
    fromId: string,
    toId: string,
    relType: string,
    props?: Record<string, unknown>,
  ): Promise<EdgeWriteResult>;

  recordEpisode(
    kind: string,
    properties?: Record<string, unknown>,
    opts?: {
      content?: string;
      occurredAt?: string | { start: string; end: string };
      participants?: Array<{ entityId: string; role?: string }>;
    },
  ): Promise<{ id: string }>;

  writeResource(
    path: string,
    body: ResourceBody | string,
    metadata?: Partial<ResourceMetadata>,
  ): Promise<void>;

  setContext(entry: ContextEntryInput): Promise<{ id: string }>;
}

export interface FormMemoryAdapters {
  entity?: EntityMemoryAdapter;
  episodic?: EpisodicMemoryAdapter;
  resources?: ResourceFsAdapter;
  context?: ContextAdapter;
}

export function createFormMemoryBridge(
  adapters: FormMemoryAdapters,
  provenance: Provenance,
): FormMemoryBridge {
  const require$ = <T>(adapter: T | undefined, name: string, method: string): T => {
    if (!adapter) {
      throw new Error(
        `ctx.memory.${method}() needs the ${name} adapter — pass it as \`memory.${name}\` when constructing the form runner.`,
      );
    }
    return adapter;
  };

  return {
    upsertNode(className, props) {
      return require$(adapters.entity, "entity", "upsertNode").addNode(
        className,
        props,
        provenance,
      );
    },
    connect(fromId, toId, relType, props) {
      return require$(adapters.entity, "entity", "connect").connect(
        fromId,
        toId,
        relType,
        props,
        provenance,
      );
    },
    recordEpisode(kind, properties, opts) {
      return require$(adapters.episodic, "episodic", "recordEpisode").recordEpisode(
        {
          kind,
          content: opts?.content ?? kind,
          occurredAt: opts?.occurredAt ?? provenance.timestamp,
          participants: opts?.participants ?? [],
          properties,
        },
        provenance,
      );
    },
    writeResource(path, body, metadata) {
      return require$(adapters.resources, "resources", "writeResource").write(
        path,
        typeof body === "string" ? { type: "markdown", text: body } : body,
        { tags: [], links: [], ...metadata },
        provenance,
      );
    },
    setContext(entry) {
      return require$(adapters.context, "context", "setContext").set(entry, provenance);
    },
  };
}
