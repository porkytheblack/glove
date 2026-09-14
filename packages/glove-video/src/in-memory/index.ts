import {
  type VideoAsset,
  type VideoAssetFilter,
  type VideoAssetStore,
  type VideoCharacterDef,
  type VideoLibraryAdapter,
  type VideoLibraryFilter,
  type VideoReview,
  type VideoReviewStore,
  type VideoSceneDef,
  VideoAssetNotFoundError,
  generateVideoAssetId,
  videoNowIso,
} from "../core/index";
import {
  type VideoFlowDefinition,
  type VideoFlowFilter,
  type VideoFlowRun,
  type VideoFlowStore,
} from "../flows/index";

function matchesTags(actual: string[] | undefined, wanted?: string[]): boolean {
  if (!wanted?.length) return true;
  return Boolean(actual && wanted.every((tag) => actual.includes(tag)));
}

export class InMemoryVideoAssetStore implements VideoAssetStore {
  readonly identifier: string;
  private entries = new Map<string, { meta: VideoAsset; bytes: Uint8Array }>();

  constructor(identifier = "in-memory-video-assets") {
    this.identifier = identifier;
  }

  async put(
    bytes: Uint8Array,
    meta: Omit<VideoAsset, "id" | "created_at">,
  ): Promise<VideoAsset> {
    const asset: VideoAsset = {
      ...meta,
      id: generateVideoAssetId(),
      created_at: videoNowIso(),
    };
    this.entries.set(asset.id, { meta: structuredClone(asset), bytes: bytes.slice() });
    return structuredClone(asset);
  }

  async get(id: string): Promise<VideoAsset | null> {
    const value = this.entries.get(id)?.meta;
    return value ? structuredClone(value) : null;
  }

  async bytes(id: string): Promise<Uint8Array> {
    const value = this.entries.get(id);
    if (!value) throw new VideoAssetNotFoundError(id);
    return value.bytes.slice();
  }

  async list(filter?: VideoAssetFilter): Promise<VideoAsset[]> {
    let values = [...this.entries.values()].map((entry) => entry.meta);
    if (filter?.source) values = values.filter((item) => item.source === filter.source);
    if (filter?.tags) values = values.filter((item) => matchesTags(item.tags, filter.tags));
    if (filter?.name_contains) {
      const needle = filter.name_contains.toLowerCase();
      values = values.filter((item) => item.name?.toLowerCase().includes(needle));
    }
    return structuredClone(values);
  }

  async remove(id: string): Promise<void> {
    this.entries.delete(id);
  }
}

export class InMemoryVideoReviewStore implements VideoReviewStore {
  readonly identifier: string;
  private reviews: VideoReview[] = [];

  constructor(identifier = "in-memory-video-reviews") {
    this.identifier = identifier;
  }

  async save(review: VideoReview): Promise<void> {
    this.reviews.push(structuredClone(review));
  }

  async latest(asset: string): Promise<VideoReview | null> {
    for (let index = this.reviews.length - 1; index >= 0; index--) {
      const value = this.reviews[index]!;
      if (value.asset === asset) return structuredClone(value);
    }
    return null;
  }

  async list(asset?: string): Promise<VideoReview[]> {
    const values = asset
      ? this.reviews.filter((review) => review.asset === asset)
      : this.reviews;
    return structuredClone(values);
  }
}

export class InMemoryVideoLibrary implements VideoLibraryAdapter {
  readonly identifier: string;
  private characters = new Map<string, VideoCharacterDef>();
  private scenes = new Map<string, VideoSceneDef>();

  constructor(identifier = "in-memory-video-library") {
    this.identifier = identifier;
  }

  async getCharacter(name: string): Promise<VideoCharacterDef | null> {
    const value = this.characters.get(name);
    return value ? structuredClone(value) : null;
  }

  async listCharacters(filter?: VideoLibraryFilter): Promise<VideoCharacterDef[]> {
    return this.filter([...this.characters.values()], filter);
  }

  async saveCharacter(def: VideoCharacterDef): Promise<void> {
    this.characters.set(def.name, structuredClone(def));
  }

  async removeCharacter(name: string): Promise<void> {
    this.characters.delete(name);
  }

  async getScene(name: string): Promise<VideoSceneDef | null> {
    const value = this.scenes.get(name);
    return value ? structuredClone(value) : null;
  }

  async listScenes(filter?: VideoLibraryFilter): Promise<VideoSceneDef[]> {
    return this.filter([...this.scenes.values()], filter);
  }

  async saveScene(def: VideoSceneDef): Promise<void> {
    this.scenes.set(def.name, structuredClone(def));
  }

  async removeScene(name: string): Promise<void> {
    this.scenes.delete(name);
  }

  private filter<T extends { name: string; tags?: string[] }>(
    values: T[],
    filter?: VideoLibraryFilter,
  ): T[] {
    let result = values;
    if (filter?.tags) result = result.filter((item) => matchesTags(item.tags, filter.tags));
    if (filter?.name_contains) {
      const needle = filter.name_contains.toLowerCase();
      result = result.filter((item) => item.name.toLowerCase().includes(needle));
    }
    return structuredClone(result);
  }
}

export class InMemoryVideoFlowStore implements VideoFlowStore {
  readonly identifier: string;
  private flows = new Map<string, VideoFlowDefinition>();
  private runs = new Map<string, VideoFlowRun>();

  constructor(identifier = "in-memory-video-flows") {
    this.identifier = identifier;
  }

  async saveFlow(flow: VideoFlowDefinition): Promise<void> {
    this.flows.set(flow.name, structuredClone(flow));
  }

  async getFlow(name: string): Promise<VideoFlowDefinition | null> {
    const value = this.flows.get(name);
    return value ? structuredClone(value) : null;
  }

  async listFlows(filter?: VideoFlowFilter): Promise<VideoFlowDefinition[]> {
    let values = [...this.flows.values()];
    if (filter?.tags) values = values.filter((item) => matchesTags(item.tags, filter.tags));
    if (filter?.name_contains) {
      const needle = filter.name_contains.toLowerCase();
      values = values.filter((item) => item.name.toLowerCase().includes(needle));
    }
    return structuredClone(values);
  }

  async removeFlow(name: string): Promise<void> {
    this.flows.delete(name);
  }

  async saveRun(run: VideoFlowRun): Promise<void> {
    this.runs.set(run.id, structuredClone(run));
  }

  async getRun(id: string): Promise<VideoFlowRun | null> {
    const value = this.runs.get(id);
    return value ? structuredClone(value) : null;
  }

  async listRuns(flow?: string): Promise<VideoFlowRun[]> {
    const values = [...this.runs.values()].filter((run) => !flow || run.flow === flow);
    return structuredClone(values);
  }
}
