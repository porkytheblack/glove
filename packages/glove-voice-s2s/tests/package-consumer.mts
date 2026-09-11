// Check the built public declarations with Node's ESM resolution. Bundler
// resolution masks incorrect default imports from CommonJS dependencies.
import {
  createS2SAdapter,
  GeminiLiveAdapter,
  OpenAILiveAdapter,
  OpenAIRealtimeAdapter,
  OpenAIRealtimeSocketAdapter,
  RealtimeAgent,
  s2sDrivenModel,
  type OpenAILiveConfig,
  type S2SAdapter,
  type S2STranscriptFragment,
} from "glove-voice-s2s";
import { createOpenAIRealtimeToken } from "glove-voice-s2s/server";

const config: OpenAILiveConfig = { getToken: () => "test", sampleRate: 16000 };
const adapter = createS2SAdapter({ provider: "openai-live", ...config });
adapter.on("transcript", (fragment: S2STranscriptFragment) => fragment.startMs);
adapter.on("usage", usage => { const final: boolean = usage.final; return final; });
const direct: S2SAdapter = new OpenAILiveAdapter(config);
direct.once("connected", () => {});
s2sDrivenModel({ provider: "openai-live", ...config });

declare const providers: [GeminiLiveAdapter, OpenAIRealtimeAdapter, OpenAIRealtimeSocketAdapter];
for (const provider of providers) provider.on("audio", pcm => pcm.length);
declare const agent: RealtimeAgent;
agent.on("transcript", fragment => fragment.endMs);
agent.on("usage", usage => usage.seconds);
void createOpenAIRealtimeToken;
