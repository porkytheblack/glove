import {
  InMemoryImageAssetStore,
  InMemoryImageLibrary,
  type ImageModelAdapter,
} from "glove-image";
import { geminiImages } from "glove-image/gemini";

export const hermesImageAssets = new InMemoryImageAssetStore("foundry-hermes-images");
export const hermesImageLibrary = new InMemoryImageLibrary("foundry-hermes-library");

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
