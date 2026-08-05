import { MemoryNotFoundError } from "../core/errors";
import { compileForm, type CompiledForm } from "./compile";
import type { FormDef } from "./types";

export interface FormRegistration<V extends Record<string, unknown> = any> {
  name: string;
  /** Shown by `glove_form_list`. Written for the model, not the developer. */
  description: string;
  /** Deferred import. Not called until the form is started. */
  load: () => Promise<FormDef<V, any>> | FormDef<V, any>;
}

export interface FormListing {
  id: string;
  name: string;
  description: string;
}

/**
 * Registry-level laziness (§4). `list()` renders name + description straight
 * off the registration — no module load, no schema compile, no zod
 * instantiation for forms the conversation never touches. `compiled()` is the
 * first thing that pays for a form, and it caches.
 */
export class FormRegistry {
  private readonly registrations = new Map<string, FormRegistration<any>>();
  private readonly compiled = new Map<string, CompiledForm<any>>();
  private readonly loading = new Map<string, Promise<CompiledForm<any>>>();

  register<V extends Record<string, unknown>>(
    id: string,
    registration: FormRegistration<V>,
  ): this {
    this.registrations.set(id, registration as FormRegistration<any>);
    return this;
  }

  has(id: string): boolean {
    return this.registrations.has(id);
  }

  list(): FormListing[] {
    return [...this.registrations.entries()].map(([id, r]) => ({
      id,
      name: r.name,
      description: r.description,
    }));
  }

  /** Load, compile and cache. Concurrent callers share one load. */
  async load(id: string): Promise<CompiledForm<any>> {
    const cached = this.compiled.get(id);
    if (cached) return cached;

    const inFlight = this.loading.get(id);
    if (inFlight) return inFlight;

    const registration = this.registrations.get(id);
    if (!registration) {
      throw new MemoryNotFoundError(`No form registered as "${id}".`);
    }

    const promise = (async () => {
      const def = await registration.load();
      const compiled = compileForm(def);
      if (compiled.id !== id) {
        // The registration key is what `glove_form_start` is called with;
        // a def whose own id disagrees would make instances unresolvable.
        throw new Error(
          `Form registered as "${id}" defines itself as "${compiled.id}".`,
        );
      }
      this.compiled.set(id, compiled);
      return compiled;
    })().finally(() => {
      this.loading.delete(id);
    });

    this.loading.set(id, promise);
    return promise;
  }

  /** Drop a cached compile — for hot reload in development. */
  invalidate(id?: string): void {
    if (id) this.compiled.delete(id);
    else this.compiled.clear();
  }
}
