import {
  ImageAssetNotFoundError,
  generateAssetId,
  type AssetFilter,
  type CharacterDef,
  type ImageAsset,
  type ImageAssetStore,
  type ImageLibraryAdapter,
  type ImageModelAdapter,
  type LibraryFilter,
  type SceneDef,
} from "glove-image";
import { geminiImages } from "glove-image/gemini";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hermesDataDirectory } from "./paths.js";

function code(cause: unknown): string | undefined {
  return cause && typeof cause === "object" && "code" in cause
    ? String((cause as { code?: unknown }).code)
    : undefined;
}

async function atomicWrite(path: string, data: string | Uint8Array): Promise<void> {
  await mkdir(hermesDataDirectory(), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, data, { mode: 0o600 });
  try {
    await rename(temporary, path);
  } catch (cause) {
    try { await unlink(temporary); } catch { /* Preserve the commit failure. */ }
    throw cause;
  }
}

function safeId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

class FileImageAssetStore implements ImageAssetStore {
  readonly identifier = "foundry-hermes-file-images";
  private get directory() { return join(hermesDataDirectory(), "media", "assets"); }

  private metadataPath(id: string) { return join(this.directory, `${id}.json`); }
  private bytesPath(id: string) { return join(this.directory, `${id}.bin`); }

  async put(bytes: Uint8Array, meta: Omit<ImageAsset, "id" | "created_at">): Promise<ImageAsset> {
    await mkdir(this.directory, { recursive: true });
    const asset: ImageAsset = {
      ...structuredClone(meta),
      id: generateAssetId(),
      created_at: new Date().toISOString(),
    };
    await atomicWrite(this.bytesPath(asset.id), bytes);
    await atomicWrite(this.metadataPath(asset.id), `${JSON.stringify(asset, null, 2)}\n`);
    return asset;
  }

  async get(id: string): Promise<ImageAsset | null> {
    if (!safeId(id)) return null;
    try {
      return JSON.parse(await readFile(this.metadataPath(id), "utf8")) as ImageAsset;
    } catch (cause) {
      if (code(cause) === "ENOENT") return null;
      throw cause;
    }
  }

  async bytes(id: string): Promise<Uint8Array> {
    if (!safeId(id)) throw new ImageAssetNotFoundError(id);
    try {
      return new Uint8Array(await readFile(this.bytesPath(id)));
    } catch (cause) {
      if (code(cause) === "ENOENT") throw new ImageAssetNotFoundError(id);
      throw cause;
    }
  }

  async list(filter: AssetFilter = {}): Promise<ImageAsset[]> {
    let names: string[];
    try { names = await readdir(this.directory); } catch (cause) {
      if (code(cause) === "ENOENT") return [];
      throw cause;
    }
    const assets = (await Promise.all(
      names.filter((name) => name.endsWith(".json"))
        .map((name) => this.get(name.slice(0, -5))),
    )).filter((asset): asset is ImageAsset => asset !== null);
    return assets.filter((asset) =>
      (!filter.source || asset.source === filter.source) &&
      (!filter.name_contains || asset.name?.toLowerCase().includes(filter.name_contains.toLowerCase())) &&
      (!filter.tags || filter.tags.every((tag) => asset.tags?.includes(tag))),
    ).sort((left, right) => right.created_at.localeCompare(left.created_at));
  }

  async remove(id: string): Promise<void> {
    if (!safeId(id)) return;
    for (const path of [this.metadataPath(id), this.bytesPath(id)]) {
      try { await unlink(path); } catch (cause) {
        if (code(cause) !== "ENOENT") throw cause;
      }
    }
  }
}

class FileImageLibrary implements ImageLibraryAdapter {
  readonly identifier = "foundry-hermes-file-image-library";
  private get directory() { return join(hermesDataDirectory(), "media", "library"); }

  private path(kind: "character" | "scene", name: string) {
    const safe = Buffer.from(name).toString("base64url");
    return join(this.directory, `${kind}-${safe}.json`);
  }

  private async read<T>(kind: "character" | "scene", name: string): Promise<T | null> {
    try { return JSON.parse(await readFile(this.path(kind, name), "utf8")) as T; } catch (cause) {
      if (code(cause) === "ENOENT") return null;
      throw cause;
    }
  }

  private async list<T extends { readonly name: string }>(kind: "character" | "scene", filter: LibraryFilter = {}): Promise<T[]> {
    let names: string[];
    try { names = await readdir(this.directory); } catch (cause) {
      if (code(cause) === "ENOENT") return [];
      throw cause;
    }
    const prefix = `${kind}-`;
    const values = (await Promise.all(names.filter((name) => name.startsWith(prefix) && name.endsWith(".json")).map(async (name) =>
      JSON.parse(await readFile(join(this.directory, name), "utf8")) as T,
    )));
    return values.filter((value) =>
      (!filter.name_contains || value.name.toLowerCase().includes(filter.name_contains.toLowerCase())) &&
      (!filter.tags || filter.tags.every((tag) => (value as T & { tags?: string[] }).tags?.includes(tag))),
    ).sort((left, right) => left.name.localeCompare(right.name));
  }

  async getCharacter(name: string) { return this.read<CharacterDef>("character", name); }
  async listCharacters(filter?: LibraryFilter) { return this.list<CharacterDef>("character", filter); }
  async getScene(name: string) { return this.read<SceneDef>("scene", name); }
  async listScenes(filter?: LibraryFilter) { return this.list<SceneDef>("scene", filter); }
  async saveCharacter(value: CharacterDef) {
    await mkdir(this.directory, { recursive: true });
    await atomicWrite(this.path("character", value.name), `${JSON.stringify(value, null, 2)}\n`);
  }
  async saveScene(value: SceneDef) {
    await mkdir(this.directory, { recursive: true });
    await atomicWrite(this.path("scene", value.name), `${JSON.stringify(value, null, 2)}\n`);
  }
  async removeCharacter(name: string) { await this.remove("character", name); }
  async removeScene(name: string) { await this.remove("scene", name); }
  private async remove(kind: "character" | "scene", name: string) {
    try { await unlink(this.path(kind, name)); } catch (cause) {
      if (code(cause) !== "ENOENT") throw cause;
    }
  }
}

export const hermesImageAssets = new FileImageAssetStore();
export const hermesImageLibrary = new FileImageLibrary();

const DEMO_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const demoImages: ImageModelAdapter = {
  name: "foundry-hermes-demo-image",
  capabilities: {
    modes: ["generate"],
    maxRefs: 0,
    refRoles: [],
    sizes: "flexible",
    negativePrompt: false,
    seed: false,
    maxCandidates: 1,
  },
  async generate() {
    return {
      images: [{ bytes: new Uint8Array(DEMO_PNG), mime: "image/png" }],
      usage: { requests: 0, tokens_in: 0, tokens_out: 0 },
    };
  },
};

export function hermesImageModel(provider: "auto" | "gemini" | "fixture") {
  if (
    provider !== "fixture" &&
    process.env.HERMES_FORCE_DEMO !== "1" &&
    process.env.GEMINI_API_KEY
  ) {
    return geminiImages({
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.HERMES_IMAGE_MODEL ?? "gemini-3.1-flash-image",
    });
  }
  return demoImages;
}
