import { z } from "zod"
// handles the state around displaying ui's to the user and is triggered by the bot
// these range from simple UIs like a table to collection UIs like forms.
// These are created by tools, meaning tools can use this to collect information or relay specific information
// Renderers are predefined and will receive data when rendering
// Renderers can optionally return data to their creator i.e in the case of forms


export interface Renderer<I, O>{
  name: string,
  inputSchema: z.ZodType<I>,
  outputSchema?: z.ZodType<O>,
  // render logic needs to be handled by a separate provider
  // render: (input: I, onComplete?: (output: O)=> Promise<void>) => Promise<unknown>
}

export interface Slot<I>{
  id: string,
  renderer: string,
  input: I
}


export type ListenerFn = (stack: Array<Slot<unknown>>) => Promise<void>
export type UnsubscribeFn = ()=>void
export type ResolverFn<RI>= (input: RI) => void
export type RejectFn = (reason?: any)=> void

export interface Resolver<RI>{
  resolve: ResolverFn<RI>
  reject: RejectFn 
}

export interface DisplayManagerAdapter {

  // list of all renderes
  renderers: Array<Renderer<unknown,unknown>>
  // display stack
  stack: Array<Slot<unknown>>
  // listeners to updates to the stack
  listeners: Set<ListenerFn>
  // resolver store holding 
  resolverStore: Map<string, Resolver<any>> 

  registerRenderer: <I, O>(renderer: Renderer<I, O>) => void

  pushAndForget: <I>(slot: Omit<Slot<I>, "id">) => Promise<string>

  pushAndWait: <I, O>(slot: Omit<Slot<I>, "id">) => Promise<O>

  notify(): Promise<void>

  subscribe(listener: ListenerFn): UnsubscribeFn

  resolve<O>(slot_id: string, value: O): void

  reject(slot_id: string, error: any): void

  removeSlot(id: string): void

  clearStack(): Promise<void>
}




export class Displaymanager implements DisplayManagerAdapter{

  private slot_counts = 0;

  renderers: Renderer<any,  any>[] = []

  stack: Slot<unknown>[] = []

  listeners = new Set<ListenerFn>();

  resolverStore: Map<string, Resolver<any>> = new Map();

  constructor(){}

  private nextSlotId(): string {
    this.slot_counts += 1;
    
    return `slot_${this.slot_counts}`
  }

  registerRenderer<I, O>(renderer: Renderer<I, O>) {
    this.renderers.push(renderer)
  }


  subscribe(listener: ListenerFn): UnsubscribeFn {
      this.listeners.add(listener)

      return () => {
        this.listeners.delete(listener)
      }
  }

  async notify(){
    for (const listener of this.listeners) {
      await listener(this.stack)
    }
  }

  async pushAndForget<I>(slot: Omit<Slot<I>, "id">): Promise<string>  {
    let slot_id = this.nextSlotId();

    this.stack.push({
      ...slot,
      id: slot_id
    })

    await this.notify()

    return slot_id
  }

  async pushAndWait<I, O>(slot: Omit<Slot<I>, "id">) {
    let slot_id = this.nextSlotId();

    this.stack.push({
      ...slot,
      id: slot_id
    })

    await this.notify()

    return new Promise<O>((resolve, reject)=>{
      this.resolverStore.set(`${slot_id}`, {
        resolve,
        reject
      })
    })
  }

  resolve<O>(slot_id: string, value: O): void {
      let handlers = this.resolverStore.get(slot_id);

      if(handlers){
        handlers.resolve(value)
        this.resolverStore.delete(slot_id)
        this.stack = this.stack.filter(s => s.id !== slot_id)
        this.notify()
      }
  }

  reject(slot_id: string, error: any): void {
    let handlers = this.resolverStore.get(slot_id);

    if(handlers){
      handlers.reject(error)
      this.resolverStore.delete(slot_id)
      this.stack = this.stack.filter(s => s.id !== slot_id)
      this.notify()
    }
  }

  removeSlot(id: string): void {
    this.stack = this.stack.filter(s => s.id !== id);
    this.notify();
  }

  async clearStack(): Promise<void> {
    this.stack = [];
    await this.notify();
  }
}
