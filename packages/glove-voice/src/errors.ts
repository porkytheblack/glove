export type GloveVoiceErrorCode =
  | "ERR_MIC_DENIED"
  | "ERR_MIC_UNAVAILABLE"
  | "ERR_STT_CONNECTION"
  | "ERR_STT_DISCONNECTED"
  | "ERR_TTS_CONNECTION"
  | "ERR_GLOVE_ABORTED"
  | "ERR_GLOVE_REQUEST";

export class GloveVoiceError extends Error {
  override readonly name = "GloveVoiceError";

  constructor(
    readonly code: GloveVoiceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
