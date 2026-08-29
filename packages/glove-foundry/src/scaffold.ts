import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

export interface ScaffoldOptions {
  directory: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function scaffoldFoundryProject(
  options: ScaffoldOptions,
): Promise<{ rootDir: string; files: string[] }> {
  const rootDir = resolve(options.directory);
  if (await exists(rootDir)) {
    const entries = await readdir(rootDir);
    if (entries.length > 0) {
      throw new Error(`Cannot scaffold into non-empty directory ${rootDir}.`);
    }
  }
  await mkdir(rootDir, { recursive: true });

  const projectName = basename(rootDir)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-|-$/g, "") || "glove-foundry-app";
  const files = new Map<string, string>([
    [
      "package.json",
      `${JSON.stringify(
        {
          name: projectName,
          version: "0.1.0",
          private: true,
          type: "module",
          scripts: {
            dev: "glove foundry dev",
            start: "glove foundry start",
            lint: "eslint .",
            typecheck: "tsc --noEmit",
          },
          dependencies: {
            effect: "^3.22.1",
            "glove-core": "^3.5.0",
            "glove-foundry": "^0.1.0",
            "glove-js": "^0.3.0",
            "glove-mcp": "^1.0.1",
            "glove-memory": "^1.0.2",
            "glove-working-environment": "^0.5.0",
            zod: "^4.3.6",
          },
          devDependencies: {
            "@types/node": "^25.2.3",
            eslint: "^9.39.2",
            "typescript-eslint": "^8.54.0",
            typescript: "^5.9.3",
          },
        },
        null,
        2,
      )}\n`,
    ],
    [
      "tsconfig.json",
      `${JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            lib: ["ES2022", "DOM"],
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: true,
            noEmit: true,
            skipLibCheck: true,
          },
          include: ["agents", "src", "foundry.application.ts", "foundry.config.ts", ".foundry/routes.d.ts"],
        },
        null,
        2,
      )}\n`,
    ],
    [
      "foundry.config.ts",
      `import { defineConfig } from "glove-foundry/config";\n\n` +
        `export default defineConfig({\n` +
        `  server: { port: 4141 },\n` +
        `  execution: {\n` +
        `    pollIntervalMs: 100,\n` +
        `    maxConcurrent: 4,\n` +
        `  },\n` +
        `});\n`,
    ],
    [
      "agents/assistant/composition.ts",
      `import { composeAgent } from "glove-foundry";\n` +
        `import notes from "./apps/notes.app.js";\n` +
        `import requestContext from "./layers/request-context.layer.js";\n` +
        `import notion from "./mcp/notion.mcp.js";\n` +
        `import personalMemory from "./memory/personal.memory.js";\n` +
        `import usage from "./subscribers/usage.subscriber.js";\n` +
        `import currentTime from "./tools/current-time.tool.js";\n\n` +
        `export const components = composeAgent(\n` +
        `  notes,\n` +
        `  requestContext,\n` +
        `  notion,\n` +
        `  personalMemory,\n` +
        `  usage,\n` +
        `  currentTime,\n` +
        `);\n`,
    ],
    [
      "agents/assistant/agent.ts",
      `import { MemoryStore } from "glove-core";\n` +
        `import { createAdapter } from "glove-core/models/providers";\n` +
      `import { defineAgent } from "glove-foundry";\n` +
        `import { components } from "./composition.js";\n` +
        `import { loadDefaultInbox } from "./inboxes/default.inbox.js";\n` +
        `import requestContext from "./layers/request-context.layer.js";\n` +
        `import personalMemory from "./memory/personal.memory.js";\n` +
        `import usage from "./subscribers/usage.subscriber.js";\n` +
        `import { assistantRepl, assistantWorkspace } from "./workbench.js";\n` +
        `\n` +
        `export default defineAgent({\n` +
        `  description: "A general-purpose Glove assistant",\n` +
        `  components,\n` +
        `  memory: [personalMemory],\n` +
        `  inboxes: (_agent, context) => loadDefaultInbox(context),\n` +
        `  workingEnvironment: assistantWorkspace,\n` +
        `  repl: (_agent, context) => assistantRepl(context.agentId, context.messageText),\n` +
        `  store: ({ conversationId }) => new MemoryStore(\`foundry:\${conversationId}\`),\n` +
        `  model: createAdapter({\n` +
        `    provider: "openrouter",\n` +
        `    model: process.env.OPENROUTER_MODEL ?? "openai/gpt-4.1-mini",\n` +
        `    stream: true,\n` +
        `  }),\n` +
        `  systemPrompt: (_agent, { message, history }) =>\n` +
        `    [\n` +
        `      "You are a precise, practical assistant.",\n` +
        `      \`Current request: \${message.text}\`,\n` +
        `      \`Prior messages: \${history.length}\`,\n` +
        `    ].join("\\n"),\n` +
        `  compactionInstructions: () =>\n` +
        `    "Preserve decisions, open work, and important context.",\n` +
        `  compactionLimit: (_agent, { messageText }) =>\n` +
        `    messageText.length > 2_000 ? 80_000 : 40_000,\n` +
        `  layers: [requestContext],\n` +
        `  subscribers: [usage],\n` +
        `});\n`,
    ],
    [
      "agents/assistant/workbench.ts",
      `import { JsSession, defineFn } from "glove-js";\n` +
        `import { defineRepl, defineWorkingEnvironment } from "glove-foundry";\n` +
        `import { z } from "zod";\n\n` +
        `export const assistantWorkspace = defineWorkingEnvironment({\n` +
        `  options: { limits: { maxVfsBytes: 32 * 1024 * 1024 } },\n` +
        `});\n\n` +
        `export function assistantRepl(actor: string, message: string) {\n` +
        `  const session = JsSession.create({ actor });\n` +
        `  session.register(defineFn({\n` +
        `    name: "request__current",\n` +
        `    description: "Read the current request inside the REPL",\n` +
        `    input: z.object({}),\n` +
        `    readOnlyHint: true,\n` +
        `    handler: () => ({ text: message, length: message.length }),\n` +
        `  }));\n` +
        `  return defineRepl({ language: "javascript", session });\n` +
        `}\n`,
    ],
    [
      "agents/assistant/layers/request-context.layer.ts",
      `import { Effect } from "effect";\n` +
        `import { defineLayer } from "glove-foundry";\n\n` +
        `const requestContext = defineLayer({\n` +
        `  description: "Expose Foundry request identity as a native Glove skill",\n` +
        `  setup: ({ glove, agentId, runId, message, history }) => Effect.sync(() => {\n` +
        `    glove.defineSkill({\n` +
        `      name: "request-context",\n` +
        `      description: "Read the current Foundry agent and run ids",\n` +
        `      exposeToAgent: true,\n` +
        `      async handler() { return \`agent=\${agentId} run=\${runId} message=\${message.text} prior=\${history.length}\`; },\n` +
        `    });\n` +
        `  }),\n` +
        `});\n\nexport default requestContext;\n`,
    ],
    [
      "agents/assistant/subscribers/usage.subscriber.ts",
      `import { defineSubscriber } from "glove-foundry";\n\n` +
        `const usage = defineSubscriber({\n` +
        `  description: "Observe token consumption without changing the agent",\n` +
        `  create: {\n` +
        `    async record(type, data) {\n` +
        `      if (type === "token_consumption") console.log("[tokens]", data);\n` +
        `    },\n` +
        `  },\n` +
        `});\n\nexport default usage;\n`,
    ],
    [
      "foundry.application.ts",
      `import { MemoryFoundryDataAdapter, defineApplication } from "glove-foundry";\n\n` +
      `export const data = new MemoryFoundryDataAdapter();\n\n` +
      `export default defineApplication({\n` +
      `  name: "${projectName}",\n` +
      `  data,\n` +
      `  accounts: [],\n` +
      `  routes: [],\n` +
      `  bindings: [],\n` +
      `});\n`,
    ],
    [
      "agents/assistant/tools/current-time.tool.ts",
      `import { defineSharedTool } from "glove-foundry";\n` +
        `import { z } from "zod";\n\n` +
        `const currentTime = defineSharedTool({\n` +
        `  description: "Return the current ISO timestamp",\n` +
        `  tool: {\n` +
        `    name: "current_time",\n` +
        `  description: "Return the current ISO timestamp",\n` +
        `  inputSchema: z.object({}),\n` +
        `  async do() {\n` +
        `    return { status: "success", data: new Date().toISOString() };\n` +
        `  },\n` +
        `  },\n` +
        `});\n\nexport default currentTime;\n`,
    ],
    [
      "agents/assistant/apps/notes.app.ts",
      `import { Effect } from "effect";\n` +
        `import { defineApp } from "glove-foundry";\n` +
        `import { z } from "zod";\n\n` +
        `const notes = defineApp({\n` +
        `  description: "An example application installed only when selected",\n` +
        `  config: z.object({ namespace: z.string().default("default") }),\n` +
        `  inbound: [],\n` +
        `  outbound: [],\n` +
        `  install: ({ config }) => Effect.sync(() => {\n` +
        `    return { tools: [{\n` +
        `      name: "notes_namespace",\n` +
        `      description: "Return the installed notes namespace",\n` +
        `      inputSchema: z.object({}),\n` +
        `      async do() { return { status: "success", data: config.namespace }; },\n` +
        `    }] };\n` +
        `  }),\n` +
        `});\n\nexport default notes;\n`,
    ],
    [
      "agents/assistant/inboxes/default.inbox.ts",
      `import type { InboxItem } from "glove-core";\n` +
        `import type { AgentAssemblyContext } from "glove-foundry";\n\n` +
        `export async function loadDefaultInbox(\n` +
        `  context: AgentAssemblyContext,\n` +
        `): Promise<ReadonlyArray<InboxItem>> {\n` +
        `  // Load this conversation's inbox from your own adapter or service.\n` +
        `  void \`\${context.agentId}:\${context.conversationId}\`;\n` +
        `  return [];\n` +
        `}\n`,
    ],
    [
      "agents/assistant/mcp/notion.mcp.ts",
      `import { defineMcp } from "glove-foundry";\n\n` +
        `// This remains disconnected until an agent instance installs it.\n` +
        `const notion = defineMcp({\n` +
        `  entry: {\n` +
        `    name: "Notion",\n` +
        `    description: "Search and update a Notion workspace",\n` +
        `    url: "https://mcp.notion.com/mcp",\n` +
        `    tags: ["notes", "workspace"],\n` +
        `  },\n` +
        `});\n\nexport default notion;\n`,
    ],
    [
      "agents/assistant/memory/personal.memory.ts",
      `import { Effect } from "effect";\n` +
        `import { defineMemory } from "glove-foundry";\n` +
        `import { MemorySchema } from "glove-memory/core";\n` +
        `import { InMemoryContextAdapter } from "glove-memory/in-memory";\n\n` +
        `const schema = new MemorySchema();\n` +
        `const context = new InMemoryContextAdapter({ schema });\n\n` +
        `const personalMemory = defineMemory({\n` +
        `  description: "Ambient user context backed by a replaceable memory adapter",\n` +
        `  context: { adapter: () => Effect.succeed(context) },\n` +
        `});\n\nexport default personalMemory;\n`,
    ],
    [
      "src/client.ts",
      `import { createFoundryClient } from "glove-foundry/client";\n` +
        `import type { FoundryRoutes } from "../.foundry/routes.js";\n\n` +
        `export const foundry = createFoundryClient<FoundryRoutes>();\n\n` +
        `const agent = await foundry.agent("assistant").create({ workspaceId: "default" });\n` +
        `const conversation = await foundry.createConversation(agent.id);\n` +
        `const run = await foundry.send(agent.id, conversation.id, "Hello");\n` +
        `const completed = await run.wait();\n` +
        `console.log(completed.output);\n`,
    ],
    [
      ".foundry/routes.d.ts",
      `// Generated by Glove Foundry. Do not edit.\n` +
        `export type FoundryRoutes = {\n` +
        `  readonly "assistant": typeof import("../agents/assistant/agent.js").default;\n` +
        `};\n`,
    ],
    [".env.example", "OPENROUTER_API_KEY=\nOPENROUTER_MODEL=openai/gpt-4.1-mini\n"],
    [
      "eslint.config.js",
      `import tseslint from "typescript-eslint";\n` +
        `import foundry from "glove-foundry/eslint";\n\n` +
        `export default [...tseslint.configs.recommended, foundry];\n`,
    ],
    [".gitignore", "node_modules\n.env.local\n.foundry/manifest.json\n"],
    [
      "README.md",
      `# ${projectName}\n\n` +
        `A file-routed Glove Foundry application.\n\n` +
        `1. Copy \`.env.example\` to \`.env.local\` and add your API key.\n` +
        `2. Install dependencies with \`pnpm install\`.\n` +
        `3. Run \`pnpm dev\`.\n` +
        `4. Open http://127.0.0.1:4141.\n\n` +
        `Add agents under \`agents/<route>/agent.ts\`; the file path is the route. Keep that agent's applications, transmissions, tools, MCPs, memory, inboxes, layers, subscribers, and workbench beside it, then combine reusable capabilities with \`composeAgent\`. Code-authored references use imported definition values; Foundry normalizes them to ids only when instance data is persisted. Applications and MCPs remain inert until an agent instance installs them. The scaffold mounts a sandboxed VFS/script environment and a request-aware JavaScript REPL; change or remove them in \`workbench.ts\`. Agents create future and recurring work only through Foundry's scheduling and sleep tools.\n`,
    ],
  ]);

  for (const [relativePath, content] of files) {
    const path = resolve(rootDir, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, { encoding: "utf8", flag: "wx" });
  }
  return { rootDir, files: [...files.keys()] };
}
