import { JsSession, defineFn } from "glove-js";
import {
  defineRepl,
  defineWorkingEnvironment,
} from "glove-foundry";
import { z } from "zod";

/**
 * The VFS, script runner, limits, and model-facing verbs are owned by the
 * native Glove working-environment package; Foundry owns contextual assembly.
 */
export const releaseWorkspace = defineWorkingEnvironment({
  options: ({ assembly }) => ({
    limits: {
      maxVfsBytes: 32 * 1024 * 1024,
      maxFileBytes: 8 * 1024 * 1024,
    },
    execution: {
      onProgress: (event) => assembly.controls.emit({
        type: "release.workspace.progress",
        data: event,
      }),
    },
    onVerb: (event) => assembly.controls.emit({
      type: "release.workspace.verb",
      data: event,
    }),
  }),
});

/** A fresh, run-scoped REPL whose available functions depend on this request. */
export function releaseRepl(
  actor: string,
  constraints: ReadonlyArray<string>,
) {
  const session = JsSession.create({ actor });
  session.register(defineFn({
    name: "release__constraints",
    description: "Read the current release constraints for computation in the REPL",
    input: z.object({}),
    readOnlyHint: true,
    handler: () => [...constraints],
  }));
  return defineRepl({
    language: "javascript",
    session,
    mount: { frame: "repl", discovery: "auto" },
  });
}
