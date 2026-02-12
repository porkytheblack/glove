import z from "zod";
import {
  Agent,
  Context,
  Executor,
  type AgentConfig,
  type CompactionConfig,
  type HandOverToAddContext,
  type Message,
  type ModelAdapter,
  type ModelPromptResult,
  Observer,
  PromptMachine,
  type StoreAdapter,
  type SubscriberAdapter,
  type Tool,
} from "./core";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Display layer
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface DisplayRenderer<I = unknown, O = unknown> {
  name: string;
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  render: (data: I, onComplete?: (output: O) => void) => void;
}

export interface DisplaySlot {
  renderer_name: string;
  data: unknown;
}

export interface DisplayStackAdapter {
  renderers: Array<DisplayRenderer>;
  stack: Array<DisplaySlot>;
  registerRenderer: (renderer: DisplayRenderer) => void;
  addAndForget: (slot: DisplaySlot) => void;
  addAndWait: (slot: DisplaySlot) => Promise<unknown>;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Fold
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface GloveFoldArgs<I> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  do: (input: I, display: DisplayStackAdapter) => Promise<unknown>;
  undo?: (input: I, display: DisplayStackAdapter) => Promise<void>;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Config
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface GloveConfig {
  store: StoreAdapter;
  model: ModelAdapter;
  displayStack: DisplayStackAdapter;
  systemPrompt: string;
  maxTurns?: number;
  maxConsecutiveErrors?: number;
  compaction?: Partial<CompactionConfig>;
}

export interface IGloveBuilder {
  fold: <I>(args: GloveFoldArgs<I>) => IGloveBuilder;
  addSubscriber: (subscriber: SubscriberAdapter) => IGloveBuilder;
  build: () => IGloveRunnable;
}

export interface IGloveRunnable {
  processRequest: (request: string) => Promise<ModelPromptResult | Message>;
  undo: (steps?: number) => Promise<number>;
  readonly displayStack: DisplayStackAdapter;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Undo registry
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface UndoEntry {
  foldName: string;
  input: unknown;
  undo: (input: unknown, display: DisplayStackAdapter) => Promise<void>;
  timestamp: number;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Glove
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class Glove implements IGloveBuilder, IGloveRunnable {
  readonly displayStack: DisplayStackAdapter;

  private store: StoreAdapter;
  private context: Context;
  private promptMachine: PromptMachine;
  private observer: Observer;
  private executor: Executor;
  private agent: Agent;

  private undoStack: UndoEntry[] = [];
  private undoFns: Map<string, GloveFoldArgs<any>["undo"]> = new Map();
  private built = false;

  constructor(config: GloveConfig) {
    this.store = config.store;
    this.displayStack = config.displayStack;

    this.context = new Context(this.store);
    this.promptMachine = new PromptMachine(config.model, config.systemPrompt);
    this.executor = new Executor();

    this.observer = new Observer(this.store, this.context, this.promptMachine, {
      tokenLimit: config.compaction?.tokenLimit ?? 100_000,
      instructions:
        config.compaction?.instructions ??
        "Summarize the conversation. Preserve: actions taken, user decisions, current state.",
    });

    this.agent = new Agent(
      this.store,
      this.executor,
      this.context,
      this.observer,
      this.promptMachine,
      {
        maxTurns: config.maxTurns ?? 50,
        maxConsecutiveErrors: config.maxConsecutiveErrors ?? 3,
      },
    );
  }

  fold<I>(args: GloveFoldArgs<I>): this {
    if (this.built) {
      throw new Error(
        `Cannot add fold "${args.name}" after build().`,
      );
    }

    if (args.undo) {
      this.undoFns.set(args.name, args.undo as GloveFoldArgs<any>["undo"]);
    }

    const displayStack = this.displayStack;
    const undoStack = this.undoStack;
    const undoFn = args.undo;

    const tool: Tool<I> = {
      name: args.name,
      description: args.description,
      input_schema: args.inputSchema,
      async run(input: I) {
        const result = await args.do(input, displayStack);

        if (undoFn) {
          undoStack.push({
            foldName: args.name,
            input,
            undo: undoFn as (
              input: unknown,
              display: DisplayStackAdapter,
            ) => Promise<void>,
            timestamp: Date.now(),
          });
        }

        return result;
      },
    };

    this.executor.registerTool(tool);
    return this;
  }

  addSubscriber(subscriber: SubscriberAdapter): this {
    this.promptMachine.addSubscriber(subscriber);
    this.executor.addSubscriber(subscriber);
    return this;
  }

  build(): IGloveRunnable {
    this.built = true;

    if (this.undoFns.size > 0) {
      this.registerUndoTool();
    }

    return this;
  }

  async processRequest(
    request: string,
  ): Promise<ModelPromptResult | Message> {
    if (!this.built) {
      throw new Error("Call build() before processRequest().");
    }

    const handOver: HandOverToAddContext = async (input: unknown) => {
      return this.displayStack.addAndWait({
        renderer_name: "input",
        data: input,
      });
    };

    return this.agent.ask({ sender: "user", text: request }, handOver);
  }

  async undo(steps = 1): Promise<number> {
    let undone = 0;

    for (let i = 0; i < steps; i++) {
      const entry = this.undoStack.pop();
      if (!entry) break;

      try {
        await entry.undo(entry.input, this.displayStack);
        undone++;
      } catch (err) {
        this.undoStack.push(entry);
        this.displayStack.addAndForget({
          renderer_name: "info",
          data: {
            type: "error",
            message: `Failed to undo "${entry.foldName}": ${err}`,
          },
        });
        break;
      }
    }

    return undone;
  }

  private registerUndoTool() {
    const glove = this;

    const tool: Tool<{ steps?: number }> = {
      name: "undo_last_action",
      description:
        `Undo the last action(s). Undoable actions: ${[...this.undoFns.keys()].join(", ")}`,
      input_schema: z.object({
        steps: z.number().optional().describe("Number of actions to undo. Default: 1"),
      }),
      async run(input) {
        const undone = await glove.undo(input.steps ?? 1);
        return undone === 0
          ? "Nothing to undo."
          : `Undid ${undone} action(s).`;
      },
    };

    this.executor.registerTool(tool);
  }
}
