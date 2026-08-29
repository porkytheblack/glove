import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { scaffoldFoundryProject } from "../src/scaffold.js";

test("scaffold creates a runnable, typed Foundry source tree", async () => {
  const parent = await mkdtemp(join(tmpdir(), "glove-foundry-scaffold-"));
  const directory = join(parent, "my-agents");
  try {
    const result = await scaffoldFoundryProject({ directory });
    assert.ok(result.files.includes("agents/assistant/agent.ts"));
    assert.ok(result.files.includes("agents/assistant/composition.ts"));
    assert.ok(result.files.includes("agents/assistant/tools/current-time.tool.ts"));
    assert.ok(result.files.includes("agents/assistant/apps/notes.app.ts"));
    assert.ok(result.files.includes("agents/assistant/mcp/notion.mcp.ts"));
    assert.ok(result.files.includes("agents/assistant/memory/personal.memory.ts"));
    assert.ok(result.files.includes("agents/assistant/inboxes/default.inbox.ts"));
    assert.ok(result.files.includes("agents/assistant/layers/request-context.layer.ts"));
    assert.ok(result.files.includes("agents/assistant/subscribers/usage.subscriber.ts"));
    assert.equal(result.files.some((file) => file.endsWith(".schedule.ts")), false);
    assert.ok(result.files.includes(".foundry/routes.d.ts"));
    assert.ok(result.files.includes("eslint.config.js"));

    const packageJson = JSON.parse(
      await readFile(join(directory, "package.json"), "utf8"),
    ) as {
      scripts: { dev: string; start: string; lint: string };
      dependencies: Record<string, string>;
    };
    assert.equal(packageJson.scripts.dev, "glove foundry dev");
    assert.equal(packageJson.scripts.start, "glove foundry start");
    assert.equal(packageJson.scripts.lint, "eslint .");
    assert.equal(packageJson.dependencies["glove-foundry"], "^0.1.0");
    assert.equal(packageJson.dependencies["glove-js"], "^0.3.0");
    assert.equal(packageJson.dependencies["glove-mcp"], "^1.0.1");
    assert.equal(packageJson.dependencies["glove-memory"], "^1.0.2");
    assert.equal(packageJson.dependencies["glove-working-environment"], "^0.5.0");

    const agent = await readFile(
      join(directory, "agents/assistant/agent.ts"),
      "utf8",
    );
    assert.match(agent, /default defineAgent/);
    assert.match(agent, /provider: "openrouter"/);
    assert.doesNotMatch(agent, /id: "assistant"/);
    assert.match(agent, /export default defineAgent/);
    assert.doesNotMatch(agent, /input: z\.object/);
    assert.doesNotMatch(agent, /output: z\./);
    assert.doesNotMatch(agent, /new Glove/);
    assert.doesNotMatch(agent, /OPENAI_API_KEY=/);
    assert.match(agent, /components,/);
    assert.match(agent, /memory: \[personalMemory\]/);
    assert.match(agent, /inboxes: \(_agent, context\) => loadDefaultInbox\(context\)/);
    assert.match(agent, /workingEnvironment: assistantWorkspace/);
    assert.match(agent, /assistantRepl/);

    const workbench = await readFile(
      join(directory, "agents/assistant/workbench.ts"),
      "utf8",
    );
    assert.match(workbench, /defineWorkingEnvironment/);
    assert.match(workbench, /defineRepl/);

    const composition = await readFile(
      join(directory, "agents/assistant/composition.ts"),
      "utf8",
    );
    assert.match(composition, /composeAgent/);
    assert.doesNotMatch(composition, /\w+\(\)/);
    assert.doesNotMatch(composition, /InstallationAdapter/);

    const application = await readFile(
      join(directory, "foundry.application.ts"),
      "utf8",
    );
    assert.doesNotMatch(application, /station|beacon|deployment/i);
    const generatedConfig = await readFile(
      join(directory, "foundry.config.ts"),
      "utf8",
    );
    assert.match(generatedConfig, /execution:/);
    assert.doesNotMatch(application, /InstallationAdapter/);
    assert.doesNotMatch(application, /transmissions:/);

    await assert.rejects(
      scaffoldFoundryProject({ directory }),
      /non-empty directory/,
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
