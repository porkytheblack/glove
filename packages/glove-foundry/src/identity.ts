export type FoundryFileDefinitionKind =
  | "action"
  | "agent"
  | "application"
  | "connection"
  | "event"
  | "layer"
  | "mcp"
  | "memory"
  | "predicate"
  | "subscriber"
  | "subscription"
  | "tool"
  | "transmission";

interface IdentityCell {
  readonly kind: FoundryFileDefinitionKind;
  id?: string;
  readonly explicit: boolean;
}

const identities = new WeakMap<object, IdentityCell>();

export type FileIdentified<T> = T & { readonly id: string };

/** @internal Attach a deferred file identity without mutating authored data. */
export function fileIdentified<T extends object>(
  value: T,
  kind: FoundryFileDefinitionKind,
  explicitId?: string,
): FileIdentified<T> {
  const cell: IdentityCell = {
    kind,
    ...(explicitId ? { id: explicitId } : {}),
    explicit: explicitId !== undefined,
  };
  const identified = { ...value } as T & { readonly id: string };
  Object.defineProperty(identified, "id", {
    enumerable: true,
    configurable: false,
    get() {
      if (cell.id) return cell.id;
      throw new Error(
        `Foundry ${kind} identity has not been bound yet. Default-export it from its convention file and let Foundry discovery derive the id.`,
      );
    },
  });
  identities.set(identified, cell);
  return identified;
}

export function isFileIdentified(value: unknown): value is { readonly id: string } {
  return Boolean(value && typeof value === "object" && identities.has(value));
}

/** @internal Bind the stable route derived from a convention filename. */
export function bindFileIdentity(
  value: object,
  id: string,
  expectedKind?: FoundryFileDefinitionKind,
): void {
  const cell = identities.get(value);
  if (!cell) {
    const current = (value as { readonly id?: unknown }).id;
    if (typeof current === "string" && current !== id) {
      throw new Error(`Foundry file route resolves to "${id}" but the definition declares "${current}".`);
    }
    return;
  }
  if (expectedKind && cell.kind !== expectedKind) {
    throw new Error(
      `Foundry ${expectedKind} route "${id}" received a ${cell.kind} definition.`,
    );
  }
  if (cell.id && cell.id !== id) {
    throw new Error(
      `Foundry ${cell.kind} route resolves to "${id}" but the definition declares "${cell.id}". Remove the explicit id and let the file own identity.`,
    );
  }
  cell.id = id;
}

export function fileDefinitionId(value: object): string {
  const cell = identities.get(value);
  if (cell?.id) return cell.id;
  return (value as { readonly id: string }).id;
}

/** Stable comparison before discovery has attached human-readable file ids. */
export function fileDefinitionKey(value: object): object | string {
  const cell = identities.get(value);
  return cell ?? value;
}

export function fileDefinitionLabel(value: object): string {
  const cell = identities.get(value);
  return cell?.id ?? `<${cell?.kind ?? "definition"} file route>`;
}

export function hasBoundFileIdentity(value: object): boolean {
  const cell = identities.get(value);
  if (cell) return cell.id !== undefined;
  try {
    return typeof (value as { readonly id?: unknown }).id === "string";
  } catch {
    return false;
  }
}
