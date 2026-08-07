// Reference in-memory adapters — dev, tests, prototypes. Process-local;
// everything is lost on restart. Production backs the same contracts onto
// object storage / a database.

import {
  type AssetFilter,
  type CharacterDef,
  type ImageAsset,
  type ImageAssetStore,
  type ImageLibraryAdapter,
  type LibraryFilter,
  type SceneDef,
  ImageAssetNotFoundError,
  generateAssetId,
  nowIso,
} from "../core/index";

function matchesTags(itemTags: string[] | undefined, wanted?: string[]): boolean {
  if (!wanted || wanted.length === 0) return true;
  if (!itemTags) return false;
  return wanted.every((t) => itemTags.includes(t));
}

export class InMemoryImageAssetStore implements ImageAssetStore {
  readonly identifier: string;
  private assets = new Map<string, { meta: ImageAsset; bytes: Uint8Array }>();

  constructor(identifier = "in-memory-image-assets") {
    this.identifier = identifier;
  }

  async put(
    bytes: Uint8Array,
    meta: Omit<ImageAsset, "id" | "created_at">,
  ): Promise<ImageAsset> {
    const asset: ImageAsset = { ...meta, id: generateAssetId(), created_at: nowIso() };
    this.assets.set(asset.id, { meta: asset, bytes: bytes.slice() });
    return asset;
  }

  async get(id: string): Promise<ImageAsset | null> {
    return this.assets.get(id)?.meta ?? null;
  }

  async bytes(id: string): Promise<Uint8Array> {
    const entry = this.assets.get(id);
    if (!entry) throw new ImageAssetNotFoundError(id);
    return entry.bytes.slice();
  }

  async list(filter?: AssetFilter): Promise<ImageAsset[]> {
    let all = [...this.assets.values()].map((e) => e.meta);
    if (filter?.source) all = all.filter((a) => a.source === filter.source);
    if (filter?.tags) all = all.filter((a) => matchesTags(a.tags, filter.tags));
    if (filter?.name_contains) {
      const needle = filter.name_contains.toLowerCase();
      all = all.filter((a) => a.name?.toLowerCase().includes(needle));
    }
    return all;
  }

  async remove(id: string): Promise<void> {
    this.assets.delete(id);
  }
}

export class InMemoryImageLibrary implements ImageLibraryAdapter {
  readonly identifier: string;
  private characters = new Map<string, CharacterDef>();
  private scenes = new Map<string, SceneDef>();

  constructor(identifier = "in-memory-image-library") {
    this.identifier = identifier;
  }

  async getCharacter(name: string): Promise<CharacterDef | null> {
    return this.characters.get(name) ?? null;
  }

  async listCharacters(filter?: LibraryFilter): Promise<CharacterDef[]> {
    return this.filterDefs([...this.characters.values()], filter);
  }

  async saveCharacter(def: CharacterDef): Promise<void> {
    this.characters.set(def.name, { ...def });
  }

  async removeCharacter(name: string): Promise<void> {
    this.characters.delete(name);
  }

  async getScene(name: string): Promise<SceneDef | null> {
    return this.scenes.get(name) ?? null;
  }

  async listScenes(filter?: LibraryFilter): Promise<SceneDef[]> {
    return this.filterDefs([...this.scenes.values()], filter);
  }

  async saveScene(def: SceneDef): Promise<void> {
    this.scenes.set(def.name, { ...def });
  }

  async removeScene(name: string): Promise<void> {
    this.scenes.delete(name);
  }

  private filterDefs<T extends { name: string; tags?: string[] }>(
    defs: T[],
    filter?: LibraryFilter,
  ): T[] {
    let out = defs;
    if (filter?.tags) out = out.filter((d) => matchesTags(d.tags, filter.tags));
    if (filter?.name_contains) {
      const needle = filter.name_contains.toLowerCase();
      out = out.filter((d) => d.name.toLowerCase().includes(needle));
    }
    return out;
  }
}
