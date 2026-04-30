import type { ClientStorage } from "./storage"
import { Box, type BoxEndpoint } from "./box"

export interface GloveboxClientOptions {
  endpoints: Record<string, BoxEndpoint>
  storage?: ClientStorage
}

/**
 * Holds a registry of named glovebox endpoints and lazily constructs `Box`
 * connections on demand.
 *
 *     const client = GloveboxClient.make({
 *       endpoints: {
 *         media: { url: "wss://media.example.com/run", key: process.env.GLOVEBOX_MEDIA_KEY! },
 *       },
 *     })
 *
 *     const result = client.box("media").prompt("trim this", { files: { "in.mp4": ... } })
 */
export class GloveboxClient {
  private boxes = new Map<string, Box>()

  private constructor(private readonly opts: GloveboxClientOptions) {}

  static make(opts: GloveboxClientOptions): GloveboxClient {
    return new GloveboxClient(opts)
  }

  box(name: string): Box {
    const cached = this.boxes.get(name)
    if (cached) return cached
    const endpoint = this.opts.endpoints[name]
    if (!endpoint) throw new Error(`Unknown glovebox endpoint: ${name}`)
    const box = new Box({ endpoint, storage: this.opts.storage })
    this.boxes.set(name, box)
    return box
  }

  async close(): Promise<void> {
    await Promise.all([...this.boxes.values()].map((b) => b.close()))
    this.boxes.clear()
  }
}
