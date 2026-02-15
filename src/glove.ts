// glove
// closed - tool registering
// open - tools that need to collect information from the user
// allow for resumption - e.g if it's a social login and the user's done logging in
// how do you achieve undos? include something in the do, that can be undone

import z from "zod";
import { Agent, Context, Executor, HandOverFunction, Message, ModelAdapter, ModelPromptResult, Observer, PromptMachine, StoreAdapter, SubscriberAdapter, Tool } from "./core";
import { DisplayManagerAdapter } from "./display-manager";


interface GloveFoldArgs<I> {
  name: string,
  description: string
  inputSchema: z.ZodType<I>,
  do: (input: I, display: DisplayManagerAdapter) => Promise<unknown>,
}

interface IGloveRunnable {
  processRequest: (request: string) => Promise<ModelPromptResult | Message>
  readonly displayManager: DisplayManagerAdapter
}


interface IGloveBuilder {
  fold: <I>(args: GloveFoldArgs<I>) => IGloveBuilder,
  addSubscriber: (subscriber: SubscriberAdapter) => IGloveBuilder,
  build: ()=> IGloveRunnable
}

interface CompactionConfig {
  max_turns?: number,
  compaction_instructions: string,
  compaction_context_limit?: number
}


interface GloveConfig {
  store: StoreAdapter,
  model: ModelAdapter,
  displayManager: DisplayManagerAdapter,
  systemPrompt: string,
  maxRetries?: number,
  maxConsecutiveErrors?: number,
  compaction_config: CompactionConfig
}


export class Glove implements IGloveBuilder, IGloveRunnable {

  readonly displayManager: DisplayManagerAdapter
  private store: StoreAdapter
  private context: Context
  private promptMachine: PromptMachine
  private observer: Observer
  private executor: Executor
  private agent: Agent

  private built = false


  constructor(config: GloveConfig) {
    this.store = config.store
    this.displayManager = config.displayManager

    this.context = new Context(this.store)
    this.promptMachine = new PromptMachine(config.model, this.context,config.systemPrompt)
    this.executor = new Executor(config.maxRetries)

    this.observer = new Observer(this.store, this.context, this.promptMachine, config.compaction_config?.compaction_instructions, config.compaction_config?.max_turns, config.compaction_config?.compaction_context_limit)

    this.agent = new Agent(
      this.store,
      this.executor,
      this.context,
      this.observer,
      this.promptMachine
    )
  }

  fold<I>(args: GloveFoldArgs<I>) {
    if (this.built) throw new Error(`Already built`);

    const displayManager = this.displayManager;
    
    const tool: Tool<I> = {
      name: args.name,
      description: args.description,
      input_schema: args.inputSchema,
      async run(input: I) {
        const result = await args.do(input, displayManager)

        return result
      }
      
    }

    this.executor.registerTool(tool)
    return this
  }

  addSubscriber(subscriber: SubscriberAdapter) {
    this.promptMachine.addSubscriber(subscriber)
    this.executor.addSubscriber(subscriber)
    
    return this
  }


  build(): IGloveRunnable {
    this.built = true;

    return this
  }


  async processRequest(request: string) {
    if (!this.built) throw new Error("Call build before processRequest");

    const handOver: HandOverFunction = async (input: unknown)=> {
      return this.displayManager.pushAndWait({
        renderer: 'generic',
        input,
        id: ``
      })
    }

    return this.agent.ask({
      sender: "user",
      text: request
    }, handOver)
  }

  
  
}






