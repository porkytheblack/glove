// The shop is data: one barista instance in the shop's workspace, seeded by
// foundry.application.ts. Every customer conversation belongs to it.

export const SHOP = {
  name: "Glove Coffee",
  workspaceId: "glove-coffee",
  agentId: "glove-coffee-barista",
} as const;

/** What the web app sends with a spoken turn. Typed turns send no payload. */
export interface TurnPayload {
  readonly voice?: {
    /** Notes GloveVoice wants the model to read with this turn (who is speaking). */
    readonly context?: readonly string[];
    /** Everyone heard on the microphone so far, by the label the model sees. */
    readonly speakers?: ReadonlyArray<{ readonly label: string; readonly name?: string }>;
  };
}
