import {} from "effect";
import z from "zod";

// call model
// model may return tool call requests or text
// if toolcalls finish calls then make request a second time
// if no tool calls then end the flow

// what we need to keep track, - messages, tooks, tool responses.
//

export type NotifySubscribersFunction = (
  event_name: string,
  event_data: unknown,
) => Promise<void>;

export interface SubscriberAdapter {
  record: (event_type: string, data: any) => Promise<void>;
}

export interface ToolResult {
  tool_name: string;
  call_id?: string;
  result: {
    data: unknown;
    status: "error" | "success";
    message?: string;
  };
}

export interface Tool<I> {
  name: string;
  description: string;
  input_schema: z.ZodType<I>;
  run(
    input: I,
    handOver?: (request: unknown) => Promise<unknown>,
  ): Promise<unknown>;
}

export interface ToolCall {
  tool_name: string;
  input_args: unknown;
  id?: string;
}

export interface Message {
  sender: "user" | "agent";
  id?: string;
  text: string;
  tool_results?: Array<ToolResult>;
  tool_calls?: Array<ToolCall>;
}

export interface PromptRequest {
  messages: Array<Message>;
  tools?: Array<Tool<unknown>>;
}

export interface ModelPromptResult {
  messages: Array<Message>;
  tokens_in: number;
  tokens_out: number;
  // TODO: other info
}

export interface ModelAdapter {
  name: string;

  prompt(
    request: PromptRequest,
    notify: NotifySubscribersFunction,
  ): Promise<ModelPromptResult>;
}

// custom store for holding all data for the context component
export interface StoreAdapter {
  identifier: string;

  set: (k: string, v: any) => Promise<void>;

  get: <V extends unknown>(k: string) => Promise<V>;

  resetPostCompaction: () => Promise<void>;
}

export class Context {
  store: StoreAdapter;
  constructor(store: StoreAdapter) {
    this.store = store;
  }

  async prepare(msg: Message) {
    let prevMessages = (await this.store.get<Array<Message>>("messages")) ?? [];

    return prevMessages;
  }

  async addMessages(msgs: Array<Message>) {
    let messages = (await this.store.get<Array<Message>>("messages")) ?? [];

    messages = [...messages, ...msgs];

    await this.store.set("messages", messages);
  }

  async getMessages() {
    let messages = (await this.store.get<Array<Message>>("messages")) ?? [];
    return messages;
  }
}

export class PromptMachine {
  context: Context;
  systemPrompt: string;
  model: ModelAdapter;
  subscribers: Array<SubscriberAdapter> = [];

  constructor(model: ModelAdapter, ctx: Context, systemPrompt: string) {
    this.context = ctx;
    this.systemPrompt = systemPrompt;
    this.model = model;
  }

  addSubscriber(subscriber: SubscriberAdapter) {
    this.subscribers.push(subscriber);
  }

  notifySubscribers = async (event_name: string, event_data: unknown) => {
    await Promise.all(
      this.subscribers.map((s) => s.record(event_name, event_data)),
    );
  };

  async run(messages: Array<Message>, tools?: Array<Tool<unknown>>) {
    const result = await this.model.prompt(
      {
        messages,
        tools,
      },
      this.notifySubscribers,
    );
    return result;
  }
}

// e.g if a tool call is requesting additional info from the user, perharps will create custom tool for this, but the good thing is this does not need to  be hardcoded into the sdk
export type HandOverToAddContext = (input: unknown) => Promise<unknown>;

export class Executor {
  tools: Array<Tool<any>> = [];
  toolCallStack: Array<ToolCall> = [];
  subscribers: Array<SubscriberAdapter> = [];

  registerTool(tool: Tool<any>) {
    this.tools.push(tool);
  }

  addSubscriber(subscriber: SubscriberAdapter) {
    this.subscribers.push(subscriber);
  }

  notifySubscribers = async (event_name: string, event_data: unknown) => {
    await Promise.all(
      this.subscribers.map((s) => s.record(event_name, event_data)),
    );
  };
  addToolCallToStack(call: ToolCall) {
    this.toolCallStack.push(call);
  }

  async executeToolStack(askHuman?: HandOverToAddContext) {
    // can send error report back to the agent when it fails

    const toolResults: Array<ToolResult> = [];

    for (const call of this.toolCallStack) {
      let tool = this.tools.find(
        (t) => t.name.toLowerCase() == call.tool_name.toLowerCase(),
      );
      if (!tool) {
        toolResults.push({
          result: {
            status: "error",
            data: null,
            message: `No tool called ${call.tool_name} exists.`,
          },
          tool_name: call.tool_name,
          call_id: call.id,
        });
        await this.notifySubscribers("tool_use_result", toolResults?.at(-1));

        continue;
      }

      const parsed_input = tool.input_schema.safeParse(call.input_args);

      if (!parsed_input.success) {
        toolResults.push({
          tool_name: call.tool_name,
          call_id: call.id,
          result: {
            status: "error",
            message: "TOOL_INPUT_INVALID",
            data: `Failed to validate the input args provided for the tool:: ${JSON.stringify(z.treeifyError(parsed_input.error))}`,
          },
        });

        await this.notifySubscribers("tool_use_result", toolResults?.at(-1));

        continue;
      }

      try {
        const result = await tool.run(parsed_input.data, askHuman);
        toolResults.push({
          tool_name: call.tool_name,
          call_id: call.id,
          result: {
            status: "success",
            data: result,
          },
        });
        this.notifySubscribers("tool_use_result", toolResults?.at(-1));
      } catch (e) {
        toolResults.push({
          tool_name: call.tool_name,
          call_id: call.id,
          result: {
            status: "error",
            message:
              "Failed to run tool successfully. Tool Errored out with ${e}",
            data: null,
          },
        });

        this.notifySubscribers("tool_use_result", toolResults?.at(-1));
      }
    }

    this.toolCallStack = [];

    return toolResults;
  }
}

export class Observer {
  MAX_TURNS: number = 120;
  CONTEXT_COMPACTION_LIMIT = 100_000; // number of tokens probably needs to be configurable per ai
  COMPACTION_INSTRUCTIONS: string;
  store: StoreAdapter;
  context: Context;
  prompt: PromptMachine;

  constructor(
    store: StoreAdapter,
    ctx: Context,
    prmpt: PromptMachine,
    compaction_instructions: string,
    max_turns?: number,
  ) {
    this.store = store;
    this.MAX_TURNS = max_turns ?? this.MAX_TURNS;
    this.context = ctx;
    this.prompt = prmpt;
    this.COMPACTION_INSTRUCTIONS = compaction_instructions ;
  }

  setCompactionInstructions(instruction: string) {
    this.COMPACTION_INSTRUCTIONS = instruction;
  }

  setMaxTurns(new_max: number) {
    this.MAX_TURNS = new_max;
  }

  setContextCompactionLimit(new_compaction_limit: number) {
    this.CONTEXT_COMPACTION_LIMIT = new_compaction_limit;
  }
  async turnComplete() {
    const current_turns = await this.store.get<number>("TURN_COUNT");
    if (current_turns == undefined) {
      await this.store.set("TURN_COUNT", 1);
    } else {
      await this.store.set("TURN_COUNT", current_turns + 1);
    }
  }

  async getCurrentTurns() {
    const current_turns = await this.store.get<number>("TURN_COUNT");
    return current_turns ?? 0;
  }

  async addTokensConsumed(token_count: number) {
    let current_token_count = await this.store.get<number>("CONSUMED_TOKENS");

    if (current_token_count == undefined) {
      await this.store.set("CONSUMED_TOKENS", token_count);
    } else {
      await this.store.set(
        "CONSUMED_TOKENS",
        current_token_count + token_count,
      );
    }
  }

  async getCurrentTokenConsumption() {
    const res = await this.store.get<number>("CONSUMED_TOKENS");
    return res ?? 0;
  }

  async tryCompaction() {
    const current_token_consumption = await this.getCurrentTokenConsumption();

    if (current_token_consumption < this.CONTEXT_COMPACTION_LIMIT) return;

    let prepared = await this.context.prepare({
      sender: "user",
      text: this.COMPACTION_INSTRUCTIONS,
    });

    let prompt_result = await this.prompt.run(prepared);

    this.store.resetPostCompaction();

    this.context.addMessages(prompt_result.messages);

    this.addTokensConsumed(prompt_result.tokens_in);
  }
}

export class Agent {
  store: StoreAdapter;
  executor: Executor;
  context: Context;
  observer: Observer;
  prompt_machine: PromptMachine;

  constructor(
    store: StoreAdapter,
    executor: Executor,
    context: Context,
    observer: Observer,
    prompt_machine: PromptMachine,
  ) {
    this.store = store;
    this.executor = executor;
    this.context = context;
    this.observer = observer;
    this.prompt_machine = prompt_machine;
  }

  async ask(message: Message, delegateToCaller?: HandOverToAddContext) {
    let _message = message;

    while (true) {
      await this.context.addMessages([_message]);
      let prepared = await this.context.prepare(_message);

      let current_turn_count = await this.observer.getCurrentTurns();

      if (current_turn_count >= this.observer.MAX_TURNS) {
        return _message;
      }

      let results = await this.prompt_machine.run(
        prepared,
        this.executor.tools,
      );
      await this.context.addMessages(results.messages);
      await this.observer.addTokensConsumed(results.tokens_in);
      await this.observer.turnComplete();

      const messages_with_tool_calls = results.messages.filter(
        (m) => (m.tool_calls?.length ?? 0) > 0,
      );

      if (messages_with_tool_calls.length == 0) return results;

      for (const message of messages_with_tool_calls) {
        for (const tool_call of message.tool_calls ?? []) {
          this.executor.addToolCallToStack(tool_call);
        }
      }

      let tool_results = await this.executor.executeToolStack(delegateToCaller);

      await this.observer.tryCompaction();

      _message = {
        sender: "user",
        text: "tool results",
        tool_results,
      };
    }
  }
}
