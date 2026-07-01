/**
 * The resource catalog — the registry of virtual tables a {@link Database}
 * exposes. Its `catalogTables()` feeds `MemoryBackend`'s `catalogProvider` so the
 * resources appear in `information_schema` for discovery, without the engine ever
 * learning what a "tool" is.
 */
import type { ResourceTable } from "./provider";

export class Catalog {
  private resources = new Map<string, ResourceTable>();

  register(resource: ResourceTable): this {
    if (this.resources.has(resource.name)) {
      throw new Error(`Catalog: resource "${resource.name}" is already registered`);
    }
    if (!resource.columns || resource.columns.length === 0) {
      throw new Error(`Catalog: resource "${resource.name}" declares no columns`);
    }
    this.resources.set(resource.name, resource);
    return this;
  }

  get(name: string): ResourceTable | undefined {
    return this.resources.get(name);
  }

  has(name: string): boolean {
    return this.resources.has(name);
  }

  list(): ResourceTable[] {
    return [...this.resources.values()];
  }

  /** Rows for `MemoryBackend.catalogProvider` — virtual tables in information_schema.
   *  Carries requiredKey (→ is_nullable='NO') and description (enum/allowed values)
   *  so a droid can discover keys and valid values via SQL, not just the preamble. */
  catalogTables(): Array<{
    name: string;
    columns: { name: string; type: string; nullable?: boolean; description?: string }[];
  }> {
    return this.list().map((r) => ({
      name: r.name,
      columns: r.columns.map((c) => ({
        name: c.name,
        type: c.type,
        nullable: c.requiredKey ? false : undefined,
        description: c.description,
      })),
    }));
  }
}
