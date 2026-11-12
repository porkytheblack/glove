import type { SubscriberAdapter } from "glove-core";
import type { IGloveRunnable } from "glove-core/glove";
import type { SpokenTurn, TurnEvent } from "./turn-events";

// GloveVoice drives a Glove agent: it calls `processRequest` with what was
// said and reads the reply from the agent's subscriber events. Here the agent
// lives in Foundry, so this stands in for it in the browser: a spoken turn
// becomes a message to the Foundry conversation, and the run's events come
// back in the shape GloveVoice listens for.

export type RunTurn = (
  text: string,
  options: { voice?: SpokenTurn; signal?: AbortSignal; onEvent?: (event: TurnEvent) => void | Promise<void> },
) => Promise<void>;

type ContextProvider = (signal?: AbortSignal) => unknown;

export class FoundryRunnable {
  private readonly subscribers = new Set<SubscriberAdapter>();
  private readonly providers = new Set<ContextProvider>();
  private waitingOnCustomer = 0;

  /**
   * GloveVoice asks the display manager whether something on screen is
   * waiting for the customer, and does not treat speech as a barge-in while
   * it is. A checkout waiting for Confirm or Decline is that.
   */
  readonly displayManager = {
    resolverStore: { size: 0 },
    clearStack: async (): Promise<void> => {},
  };

  constructor(private readonly runTurn: RunTurn) {
    Object.defineProperty(this.displayManager.resolverStore, "size", { get: () => this.waitingOnCustomer });
  }

  addSubscriber(subscriber: SubscriberAdapter): void {
    this.subscribers.add(subscriber);
  }

  removeSubscriber(subscriber: SubscriberAdapter): void {
    this.subscribers.delete(subscriber);
  }

  /** GloveVoice registers its note about who is speaking here. */
  addContextProvider(provider: ContextProvider): () => void {
    this.providers.add(provider);
    return () => {
      this.providers.delete(provider);
    };
  }

  async processRequest(text: string, signal?: AbortSignal): Promise<{ messages: [] }> {
    // Read once per turn and sent with it, never stored in the conversation.
    const context: string[] = [];
    for (const provider of this.providers) {
      const note = await provider(signal);
      if (typeof note === "string" && note.trim()) context.push(note);
    }

    // The listeners of this turn. After a barge-in GloveVoice subscribes
    // again for the next turn, and that one must not hear the rest of this.
    const listeners = [...this.subscribers];
    const notify = async (type: string, data: unknown): Promise<void> => {
      for (const subscriber of listeners) {
        if (signal?.aborted) return;
        await (subscriber.record as (type: string, data: unknown) => Promise<void>)(type, data);
      }
    };

    try {
      await this.runTurn(text, {
        // The caller adds who has been heard; see app/page.tsx.
        voice: { context, speakers: [] },
        signal,
        onEvent: async (event) => {
          if (event.type === "text") await notify("text_delta", { text: event.text });
          else if (event.type === "response_end") await notify("model_response_complete", { text: "", stop_reason: "end_turn", tokens_in: 0, tokens_out: 0 });
          else if (event.type === "approval") this.waitingOnCustomer += 1;
          else if (event.type === "approval_resolved") this.waitingOnCustomer = Math.max(0, this.waitingOnCustomer - 1);
        },
      });
    } finally {
      this.waitingOnCustomer = 0;
    }
    return { messages: [] };
  }

  /** The part of `IGloveRunnable` GloveVoice uses. */
  asGlove(): IGloveRunnable {
    return this as unknown as IGloveRunnable;
  }
}
