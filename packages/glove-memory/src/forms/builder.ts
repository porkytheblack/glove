import type { z } from "zod";
import type {
  CheckpointConfig,
  CheckpointDef,
  FieldConfig,
  FieldDef,
  FormDef,
  FormExecutor,
  StepConfig,
  StepDef,
} from "./types";

export interface FormDefConfig {
  id: string;
  version: number;
  name: string;
  /** What the form is for. Shown by `glove_form_list` without loading the module. */
  description: string;
  /** How to run the conversation. Injected with tier 0 while an instance is open. */
  conduct?: string;
  /** Carry values forward from an older instance instead of going stale (§5.2). */
  migrate?: (old: unknown, fromVersion: number) => Record<string, unknown>;
}

/** Extract the accumulated values type from a builder or a built def. */
export type StepValues<SB> = SB extends StepBuilder<infer VS, any> ? VS : {};

/**
 * Fields collected inside one `.step(...)` call.
 *
 * `V` is the whole form's values accumulated so far — not just this step's —
 * so a gate written on the third field of the second step can read the first
 * step's answers. `F` is this step's field ids.
 */
export class StepBuilder<V extends Record<string, unknown> = {}, F extends string = never> {
  /** @internal */ readonly __fields: FieldDef<any>[] = [];
  /** @internal */ __onComplete?: FormExecutor<any>;
  /** Phantom — carries `V` for `StepValues`. Never assigned. */
  declare readonly __values?: V;
  /** Phantom — carries the field-id union. Never assigned. */
  declare readonly __fieldIds?: F;

  field<K extends string, T extends z.ZodTypeAny>(
    id: K,
    config: FieldConfig<T, V>,
  ): StepBuilder<V & { [P in K]: z.infer<T> }, F | K> {
    this.__fields.push({
      id,
      schema: config.schema,
      label: config.label,
      ask: config.ask,
      hint: config.hint,
      when: config.when as FieldDef<any>["when"],
      onFill: config.onFill as FormExecutor<any> | undefined,
    });
    return this as unknown as StepBuilder<V & { [P in K]: z.infer<T> }, F | K>;
  }

  /** Runs when this step's applicable required fields are all valid. */
  onComplete(run: FormExecutor<V>): StepBuilder<V, F> {
    this.__onComplete = run as FormExecutor<any>;
    return this;
  }
}

/**
 * Colocated, type-threaded form definition.
 *
 * Each `.field()` widens the accumulated values type, so every predicate and
 * executor downstream is typed against the real shape — `values.incidentType`
 * narrows to its enum union, `values.phone` is `string | undefined`.
 */
export class FormBuilder<
  V extends Record<string, unknown> = {},
  S extends string = never,
> {
  private readonly config: FormDefConfig;
  private readonly steps: StepDef<any>[] = [];
  private readonly checkpoints: CheckpointDef<any>[] = [];
  private formOnComplete?: FormExecutor<any>;

  /** Phantom — carries `V` for `FormValues`. Never assigned. */
  declare readonly __values?: V;
  /** Phantom — carries the step-id union. Never assigned. */
  declare readonly __steps?: S;

  constructor(config: FormDefConfig) {
    this.config = config;
  }

  step<ID extends string, SB extends StepBuilder<any, any>>(
    id: ID,
    config: StepConfig<V, S>,
    build: (s: StepBuilder<V>) => SB,
  ): FormBuilder<V & StepValues<SB>, S | ID> {
    const sub = new StepBuilder<V>();
    // `build` chains on and returns the same instance; take the return value
    // when it is one, so a builder that ends on a non-chaining helper still
    // contributes its fields.
    const finished = build(sub);
    const source = finished instanceof StepBuilder ? finished : sub;
    this.steps.push({
      id,
      title: config.title,
      ask: config.ask,
      preview: config.preview,
      when: config.when as StepDef<any>["when"],
      fields: source.__fields,
      onComplete: source.__onComplete,
    });
    return this as unknown as FormBuilder<V & StepValues<SB>, S | ID>;
  }

  checkpoint<ID extends string>(
    id: ID,
    config: CheckpointConfig<V, S>,
  ): FormBuilder<V, S> {
    this.checkpoints.push({
      id,
      when: config.when as CheckpointDef<any>["when"],
      blocking: config.blocking ?? false,
      waitMessage: config.waitMessage,
      run: config.run as FormExecutor<any>,
    });
    return this;
  }

  /** Runs when every applicable required field in the form is valid. */
  onComplete(run: FormExecutor<V>): FormBuilder<V, S> {
    this.formOnComplete = run as FormExecutor<any>;
    return this;
  }

  build(): FormDef<V, S> {
    return {
      id: this.config.id,
      version: this.config.version,
      name: this.config.name,
      description: this.config.description,
      conduct: this.config.conduct,
      steps: this.steps as StepDef<V>[],
      checkpoints: this.checkpoints as CheckpointDef<V>[],
      onComplete: this.formOnComplete as FormExecutor<V> | undefined,
      migrate: this.config.migrate as FormDef<V, S>["migrate"],
    };
  }
}

export function defineForm(config: FormDefConfig): FormBuilder<{}, never> {
  return new FormBuilder<{}, never>(config);
}
