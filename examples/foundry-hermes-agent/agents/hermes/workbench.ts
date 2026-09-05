import { documents } from "glove-env-documents";
import { spreadsheets } from "glove-env-spreadsheets";
import {
  defineRepl,
  defineWorkingEnvironment,
  foundryDataEnvironmentPersistence,
} from "glove-foundry";
import { JsSession, defineFn } from "glove-js";
import { z } from "zod";

export const hermesWorkspace = defineWorkingEnvironment({
  options: ({ assembly }) => ({
    stdlib: [documents(), spreadsheets()],
    limits: {
      maxVfsBytes: 96 * 1024 * 1024,
      maxFileBytes: 24 * 1024 * 1024,
      runTimeoutMs: 30_000,
    },
    execution: {
      prewarm: true,
      onProgress: (event) => assembly.controls.emit({ type: "hermes.workspace.progress", data: event }),
    },
    onVerb: (event) => assembly.controls.emit({ type: "hermes.workspace.verb", data: event }),
  }),
  persistence: foundryDataEnvironmentPersistence({ scope: "agent" }),
  mount: { prime: true, toolPrefix: "workspace_" },
});

export function hermesRepl(agentId: string, workspaceId: string, request: string) {
  const session = JsSession.create({ actor: agentId });
  session.register(defineFn({
    name: "hermes__context",
    description: "Return the current instance, workspace, and request",
    input: z.object({}),
    readOnlyHint: true,
    handler: () => ({ agentId, workspaceId, request }),
  }));
  return defineRepl({
    language: "javascript",
    session,
    mount: { frame: "workflow", discovery: "auto" },
  });
}
