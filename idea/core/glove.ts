// glove
// closed - tool registering
// open - tools that need to collect information from the user
// allow for resumption - e.g if it's a social login and the user's done logging in
// how do you achieve undos? include something in the do, that can be undone

import z from "zod";
import { Agent, Context, Executor, HandOverToAddContext, Message, ModelAdapter, ModelPromptResult, NotifySubscribersFunction, Observer, PromptMachine, StoreAdapter, Tool } from ".";

type DisplayRendererOnCompleteFn<O> = (output: O) => void

interface DisplayRenderer<I, O>{
  name: string,
  inputSchema: z.ZodType<I>,
  outputSchema: z.ZodType<O>,
  render: (data: I, onComplete?: DisplayRendererOnCompleteFn<O>) => void 
} 

interface DisplaySlot {
  renderer_name: string, // renderer can be info or form
  data: unknown
} // the latest slot is the one that get's actively rendered

interface DisplayStackAdapter {
  tempStore: Map<string, any> // temp store is gonna temporarily hold onComplete data from renderer before it's dispatched in an addAndWait function which will have the responsibility of cleaning it out as well
  renderers: Array<DisplayRenderer<unknown, unknown>> // lib of all available ui's will be referenced in the display slots 
  stack: Array<DisplaySlot> // the Stack Renderer is gonna be situation specific and will just be reading this list as it's mutated and rendering it
  addAndForget: (slot: DisplaySlot) => void // e.g for just showing information you could just add it to the stack and let it be rendered 
  addAndWait: (slot: DisplaySlot) => Promise<unknown> // e.g for a form where you expect to collect information, you could just add it and then get the resultant info from it and do stuff
}

interface GloveFoldArgs<I> {
  name: string,
  description: string
  inputSchema: z.ZodType<I>,
  do: (input: I, handOver: HandOverToAddContext) => Promise<void>
}

interface IGlove {
  store: StoreAdapter
  model: ModelAdapter
  displayStack: DisplayStackAdapter
  addSubscription: (subscriber: NotifySubscribersFunction) => IGlove
  fold: (args: GloveFoldArgs<unknown>) => IGlove
  build: () => IGlove,
  processRequest: (request: string) => Promise<Message | ModelPromptResult>
}

interface GloveArgs {
  store: StoreAdapter
  model: ModelAdapter,
  displayStack: DisplayStackAdapter,
  systemPrompt: string,
  maxTurns?: number,
  compactionInstructions: string
}


class Glove implements IGlove {
  store: StoreAdapter;
  model: ModelAdapter;
  displayStack: DisplayStackAdapter;
  private context: Context
  private promptMachine: PromptMachine
  private observer: Observer 
  private agent: Agent
  private executor: Executor
  
  constructor(args: GloveArgs) {
    this.store = args.store
    this.model = args.model
    this.displayStack = args.displayStack
    
    this.context = new Context(this.store)
    this.promptMachine = new PromptMachine(this.model, this.context, args.systemPrompt)
    this.executor = new Executor()
    this.observer = new Observer(this.store, this.context, this.promptMachine,  args.compactionInstructions, args.maxTurns)
    this.agent = new Agent(
      this.store,
      this.executor,
      this.context,
      this.observer,
      this.promptMachine
    )
    
  }
  
  fold(args: GloveFoldArgs<unknown>){
    let tool: Tool<unknown> = {
      name: args.name,
      description: args.description,
      input_schema: args.inputSchema,
      run: args.do
    }
    this.executor.registerTool(tool)
    return this
  }
}



