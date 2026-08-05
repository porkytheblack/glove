export {
  useGloveS2S,
  type UseGloveS2SConfig,
  type UseGloveS2SReturn,
} from "./use-glove-s2s";

// Re-exported for convenience so consumers don't need a second import to
// type a session, a tool host, or a state value.
export type {
  GloveS2SConfig,
  S2SAdapter,
  S2SState,
  S2STool,
  S2SToolHost,
} from "glove-voice-s2s";
