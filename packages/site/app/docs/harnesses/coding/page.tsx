import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { Blueprint, HarnessDiagram } from "@/components/diagrams";
import { docsMetadata } from "@/lib/docs-nav";

export const metadata = docsMetadata("/docs/harnesses/coding");

export default function CodingHarnessPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Harness blueprint</span>
      <h1>Coding agent</h1>
      <p className="blog-lede">
        A coding harness reads a repository, plans a change, edits files, runs commands and checks
        its own work. It leans on three parts: tools (file and shell access with permission
        gates), a workspace (the checkout, or a sandbox when the code is not yours to trust) and
        context (repository guides, a task list, and compaction for long sessions). Everything
        except the file and shell tools themselves is already in Glove.
      </p>

      <Blueprint
        uses={[
          "Agent loop",
          "Model adapters",
          "Abort and un-abortable tools",
          "Subscribers",
          "Tools",
          "Permission gates",
          "Content skills",
          "Task list",
          "Compaction",
          "Store",
          "Sandboxes",
          "Kuiper sandboxes",
          "Display stack",
          "Subagents",
        ]}
        write={[
          "read_file, write_file, edit_file, grep, bash (or reuse examples/coding-agent/tools.ts)",
          "The system prompt: workflow rules for your codebase",
          "The surface: a terminal or a web client that renders permission and plan slots",
        ]}
      />

      <h2 id="how-it-fits">How it fits together</h2>
      <p>
        A request such as &ldquo;make the retry test pass&rdquo; arrives from the surface and is
        saved to the store. Before the first model call, Glove assembles context: the system
        prompt, the saved history, and any runtime context you registered. The model reads the
        skill listing that <code>useReadSkill</code> folded in and pulls the testing guide it
        needs. It calls <code>glove_update_tasks</code> to lay out a plan, then explores with
        read-only tools.
      </p>
      <p>
        When it calls <code>edit_file</code> or <code>bash</code>, the executor checks the
        permission gate. The store has no decision for that tool and input yet, so the executor
        pushes a <code>permission_request</code> slot onto the display stack and the tool waits.
        Your surface renders it, the person approves, and <code>display.resolve(slotId, true)</code>{" "}
        lets the call through. The decision is stored, so the same input does not ask again.
        Results are saved, the loop continues, and subscribers stream text and tool events to the
        surface the whole time. If the session grows past the compaction limit, Glove summarises
        it and the model carries on from the summary; the store keeps the full history for your UI.
      </p>
      <HarnessDiagram
        highlight="tools"
        caption="A coding harness is mostly tools: the model asks for reads, edits and commands; the executor gates the dangerous ones through the display stack before they run, and every result is saved before the next model call."
      />

      <h2 id="skeleton">Skeleton</h2>
      <p>
        This is the core of <code>examples/coding-agent/server.ts</code>, reduced to the parts that
        matter. The tool implementations are yours; the example ships a complete set.
      </p>
      <CodeBlock
        filename="agent.ts"
        language="typescript"
        code={`import {
  Displaymanager,
  Glove,
  MemoryStore,
  createAdapter,
  useReadSkill,
  type SubscriberAdapter,
} from "glove-core";
import { loadContentSkillsFromFs } from "glove-core/content-skills-fs";
import { z } from "zod";
// Your code: read_file, write_file, edit_file, grep, bash, git_* as glove-core Tools.
// examples/coding-agent/tools.ts has a complete set to start from.
import { codingTools, readOnlyTools } from "./tools.js";

const DESTRUCTIVE = new Set(["write_file", "edit_file", "bash"]);

export async function createCodingAgent(cwd: string, surface: SubscriberAdapter) {
  const display = new Displaymanager();
  const store = new MemoryStore(\`coding:\${cwd}\`); // tasks + permissions + subagent stores built in

  const agent = new Glove({
    store,
    model: createAdapter({ provider: "anthropic", model: "claude-sonnet-5-5", stream: true }),
    displayManager: display,
    systemPrompt: \`You are a coding agent working in \${cwd}.
Explore before you change anything. Track multi-step work with glove_update_tasks.
Run the tests before you say you are done.\`,
    compaction_config: {
      max_turns: 50,
      compaction_instructions:
        "Summarise the work. Keep: files changed, task state, failing tests, decisions made.",
    },
  });

  for (const tool of codingTools) {
    agent.fold<any>({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.input_schema,
      // Ask before anything that writes or executes. A function form can
      // exempt read-only shell commands: (input) => !isReadOnly(input.command)
      requiresPermission: DESTRUCTIVE.has(tool.name),
      do: (input) => tool.run(input),
    });
  }

  // A plan the person approves before the agent edits anything.
  agent.fold({
    name: "propose_plan",
    description: "Show a step-by-step plan and wait for the user to approve or change it.",
    inputSchema: z.object({ title: z.string(), steps: z.array(z.string()) }),
    async do(input, display) {
      const decision = await display.pushAndWait({ renderer: "plan_approval", input });
      return { status: "success", data: decision };
    },
  });

  // A read-only explorer the main agent can hand questions to.
  agent.defineSubAgent({
    name: "explorer",
    description: "Answer a question about the codebase by reading files. Never edits.",
    factory: async ({ parentStore, parentControls }) => {
      const child = new Glove({
        store: (await parentStore.createSubAgentStore?.("explorer", false)) ?? new MemoryStore("explorer"),
        model: parentControls.glove.model,
        displayManager: parentControls.displayManager,
        systemPrompt: "Find the answer in the code. Quote paths and line numbers.",
        compaction_config: { compaction_instructions: "Keep the findings." },
      });
      for (const tool of readOnlyTools) {
        child.fold<any>({ name: tool.name, description: tool.description, inputSchema: tool.input_schema, do: (input) => tool.run(input) });
      }
      return child.build();
    },
  });

  agent.addSubscriber(surface); // text_delta, tool_use, tool_use_result, compaction, tokens
  const built = agent.build();

  // Repository guides (.claude/skills/<name>/SKILL.md) as skills the agent reads on demand.
  useReadSkill(built, await loadContentSkillsFromFs(\`\${cwd}/.claude/skills\`));

  return { agent: built, display };
}`}
      />
      <p>The surface answers the slots the tools push. In a terminal it can be this small:</p>
      <CodeBlock
        filename="terminal.ts"
        language="typescript"
        code={`const { agent, display } = await createCodingAgent(process.cwd(), terminalSubscriber);
const answered = new Set<string>();

display.subscribe(async (stack) => {
  for (const slot of stack) {
    if (answered.has(slot.id)) continue;
    answered.add(slot.id);
    // Don't await inside the listener: pushAndWait registers its resolver only
    // after every listener returns. Ask on the next tick, then resolve.
    setImmediate(async () => {
      if (slot.renderer === "permission_request") {
        const { toolName, toolInput } = slot.input as { toolName: string; toolInput: unknown };
        display.resolve(slot.id, await confirm(\`Allow \${toolName}? \${JSON.stringify(toolInput)}\`)); // your prompt
      }
      if (slot.renderer === "plan_approval") {
        display.resolve(slot.id, await reviewPlan(slot.input)); // your prompt
      }
    });
  }
});

const controller = new AbortController();
process.on("SIGINT", () => controller.abort()); // Ctrl-C stops the loop; unAbortable tools finish first
await agent.processRequest("Make the retry test pass", controller.signal);`}
      />

      <h3 id="sandbox">When the code is not yours: a sandbox</h3>
      <p>
        Host tools are fine for your own checkout on your own machine. For anyone else&apos;s
        code, or a hosted agent, run commands in a container instead.{" "}
        <code>mountSandbox</code> from <code>glove-execution</code> adds{" "}
        <code>execute_sandbox</code>: the model writes one script that creates a sandbox, writes
        files, runs commands and reads the output, and the scope tracks which sandboxes this run
        owns. In Foundry, the managed Station can host the container provider and the agent mounts
        it in <code>configure</code>, exactly as{" "}
        <a href="https://github.com/porkytheblack/glove/tree/main/examples/foundry-operator">
          examples/foundry-operator
        </a>{" "}
        does:
      </p>
      <CodeBlock
        filename="agents/coder/agent.ts"
        language="typescript"
        code={`import { defineAgent } from "glove-foundry";
import { mountSandbox } from "glove-execution";
import { stationSandbox } from "glove-execution/station";
import { StationClient } from "station-client";

export default defineAgent({
  description: "Writes and runs code in a persistent container",
  // model, systemPrompt, store …
  async configure(agent, context) {
    // Your code: the connection the application saved from stationDaemon's onReady,
    // and the sandbox ids this instance was granted on earlier runs.
    const connection = await loadStationConnection();
    const adapter = await stationSandbox({
      client: new StationClient({ url: connection.url, token: connection.token }),
      stationId: connection.stationId,
      sandboxIds: await loadSandboxGrants(context.agentId),
      cleanup: "retain", // keep files and services between runs
    });
    let close = () => adapter.close();
    context.onCleanup(() => close()); // register before anything else can fail
    const sandbox = mountSandbox(agent, { adapter });
    close = () => sandbox.close();
  },
});`}
      />
      <p>
        To let the agent edit a real checkout but review the change before it lands,{" "}
        <Link href="/docs/vfs">glove-vfs</Link>&apos;s <code>hostDirectory(dir)</code> keeps every
        write in memory until you call <code>commit()</code>.
      </p>

      <h2 id="dont-build">What not to build</h2>
      <ul>
        <li>
          <strong>A confirm-before-write wrapper in each tool.</strong>{" "}
          <Link href="/docs/display-stack">Permission gates</Link> (
          <code>requiresPermission</code>) ask through the display stack and remember the
          decision per tool and input.
        </li>
        <li>
          <strong>A todo tool.</strong> Any store with tasks gets{" "}
          <Link href="/docs/core#task-tool"><code>glove_update_tasks</code></Link>, and your UI can
          watch it through <code>tool_use_result</code> events.
        </li>
        <li>
          <strong>Pasting every contributing guide into the prompt.</strong>{" "}
          <Link href="/docs/extensions">Content skills</Link> list the guides and let the model read
          the one it needs, by section.
        </li>
        <li>
          <strong>History trimming.</strong>{" "}
          <Link href="/docs/core#compaction-config">Compaction</Link> summarises the session at the
          limit and keeps tool calls paired with their results.
        </li>
        <li>
          <strong>A second agent you call by hand for exploration.</strong>{" "}
          <Link href="/docs/extensions">Subagents</Link> are a tool the model routes to, with their
          own store and tools, and their events bracketed in the parent&apos;s stream.
        </li>
        <li>
          <strong>docker exec wrappers.</strong>{" "}
          <Link href="/docs/execution">mountSandbox</Link> gives the model a script surface over
          sandboxes with ownership, bounded output and cleanup.
        </li>
      </ul>

      <h2 id="deploy">Deploy on Kuiper</h2>
      <p>
        A local coding harness needs no deployment. A hosted one, where people send it tasks and
        it works in its own containers, runs as a Foundry app:
      </p>
      <ol>
        <li>
          Put the agent in <code>agents/coder/agent.ts</code> and host the container provider on
          the managed Station with <code>stationDaemon</code> in{" "}
          <code>foundry.application.ts</code> (see{" "}
          <Link href="/foundry/docs/browser-and-sandbox">Browser &amp; sandbox agent</Link>).
        </li>
        <li>
          Commit a <code>kuiper.json</code> (start from <code>kuiper manifest init --foundry</code>)
          and add <code>&quot;capabilities&quot;: {"{"} &quot;sandbox&quot;: {"{"} &quot;maxConcurrent&quot;: 2 {"}"} {"}"}</code>.
          The unit then gets a Docker socket that Kuiper serves and polices; every container runs
          under gVisor within the unit&apos;s limits. Kuiper&apos;s{" "}
          <a href="https://kuiper.sh/docs/sandbox-images/">sandbox images</a>, such as{" "}
          <code>kuiper/coding</code>, run by name.
        </li>
        <li>
          Keep Foundry&apos;s data, transcripts and sandbox grants under <code>/data</code>, the
          unit&apos;s persistent disk.
        </li>
        <li>
          Point the model at the gateway so provider keys never reach the unit:{" "}
          <code>kuiper env set -u coder &apos;MODELS_API_KEY=${"{{"}models.API_KEY{"}}"}&apos; &apos;ANTHROPIC_BASE_URL=${"{{"}models.ANTHROPIC_BASE_URL{"}}"}&apos;</code>{" "}
          and pass both to <code>createAdapter</code>.
        </li>
        <li>
          <code>kuiper deploy --source . -u coder --wait</code>, then open the unit&apos;s Inspect
          card to watch runs.
        </li>
      </ol>
      <p>
        Sandboxes can also come from Kuiper&apos;s own sandbox API instead of the unit&apos;s Docker
        socket; see <a href="https://kuiper.sh/docs/sandboxes/">Kuiper sandboxes</a>. The full
        walkthrough is <Link href="/foundry/docs/kuiper">Deploy on Kuiper</Link>.
      </p>

      <h2 id="further">Go further</h2>
      <ul>
        <li>
          <a href="https://github.com/porkytheblack/glove/tree/main/examples/coding-agent">
            examples/coding-agent
          </a>
          : the full harness with a WebSocket server, a React client, plan approval and permission
          prompts. The <Link href="/docs/showcase/coding-agent">walkthrough</Link> explains every
          file.
        </li>
        <li>
          Build the parts one at a time: <Link href="/docs/build/loop">a loop and a tool</Link>,{" "}
          <Link href="/docs/build/surface">show your work</Link>,{" "}
          <Link href="/docs/build/context">control what it sees</Link>,{" "}
          <Link href="/docs/build/workspace">give it a workspace</Link>.
        </li>
        <li>
          Reference: <Link href="/docs/server-side">Server-side agents</Link>,{" "}
          <Link href="/docs/extensions">Hooks, skills &amp; subagents</Link>,{" "}
          <Link href="/docs/execution">Browsers &amp; sandboxes</Link>,{" "}
          <Link href="/docs/code-execution">Code execution</Link>.
        </li>
      </ul>
    </article>
  );
}
