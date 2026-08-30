import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { scaffoldFoundryProject } from "../src/scaffold.js";
import { resolveTemplateVersions } from "../src/scaffold-versions.js";

async function workspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "glove-foundry-scaffold-"));
}

test("the default template is a worked example that uses every convention", async () => {
  const parent = await workspace();
  const directory = join(parent, "my-agents");
  try {
    const result = await scaffoldFoundryProject({ directory });
    assert.equal(result.template, "travel-concierge");
    assert.equal(result.target, "standalone");
    assert.equal(result.agentsDir, "agents");
    assert.equal(result.agentRoute, "concierge");

    // One example, every convention directory Foundry discovers.
    for (const file of [
      "agents/concierge/agent.ts",
      "agents/concierge/composition.ts",
      "agents/concierge/tools/find-flights.tool.ts",
      "agents/concierge/apps/calendar.app.ts",
      "agents/concierge/transmissions/messaging.transmission.ts",
      "agents/concierge/events/message-received.event.ts",
      "agents/concierge/predicates/mentions-trip.predicate.ts",
      "agents/concierge/memory/traveller.memory.ts",
      "agents/concierge/schedules/trip-countdown.ts",
      "agents/concierge/layers/trip-context.layer.ts",
      "agents/concierge/subscribers/usage.subscriber.ts",
      "agents/concierge/actions/reply.action.ts",
      "agents/concierge/topology.ts",
      "agents/concierge/workbench.ts",
      "foundry.application.ts",
      "foundry.config.ts",
      "package.json",
      "tsconfig.json",
      "eslint.config.js",
      ".gitignore",
      ".env.example",
      ".foundry/routes.d.ts",
      "README.md",
    ]) {
      assert.ok(result.files.includes(file), `expected ${file}`);
    }

    const agent = await readFile(join(directory, "agents/concierge/agent.ts"), "utf8");
    assert.match(agent, /export default defineAgent/);
    // File routing owns identity, so a hand-written id is a mistake.
    assert.doesNotMatch(agent, /id: "concierge"/);
    // A fresh project runs before a provider is configured.
    assert.match(agent, /new DemoModel\(\)/);
    assert.match(agent, /provider: "openrouter"/);

    // The generated declaration has to point at where the agents were written.
    const routes = await readFile(join(directory, ".foundry/routes.d.ts"), "utf8");
    assert.match(routes, /import\("\.\.\/agents\/concierge\/agent\.js"\)/);

    // The README is the documentation the project ships with, so it names the
    // commands, the conventions, and the packages rather than being a stub.
    const readme = await readFile(join(directory, "README.md"), "utf8");
    assert.match(readme, /my-agents/);
    assert.match(readme, /defineSharedTool/);
    assert.match(readme, /defineTransmission/);
    assert.match(readme, /glove-working-environment/);
    assert.match(readme, /localhost:4141|127\.0\.0\.1:4141/);
    assert.doesNotMatch(readme, /\{\{\w+\}\}/, "every placeholder is filled");

    await assert.rejects(scaffoldFoundryProject({ directory }), /non-empty directory/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("scaffolded dependencies match the versions this Foundry was built against", async () => {
  const parent = await workspace();
  const directory = join(parent, "versioned");
  try {
    await scaffoldFoundryProject({ directory });
    const manifest = JSON.parse(
      await readFile(join(directory, "package.json"), "utf8"),
    ) as { scripts: Record<string, string>; dependencies: Record<string, string> };

    assert.equal(manifest.scripts.dev, "glove foundry dev");
    assert.equal(manifest.scripts.start, "glove foundry start");

    // A range narrower than what glove-foundry itself requires makes npm nest a
    // second copy of the package, and every shared class stops type-matching.
    const versions = await resolveTemplateVersions();
    assert.equal(manifest.dependencies["glove-foundry"], versions.foundry);
    for (const name of ["glove-core", "glove-js", "glove-memory", "glove-working-environment"]) {
      assert.equal(
        manifest.dependencies[name],
        versions.dependencies[name as keyof typeof versions.dependencies],
        `${name} must match the resolved range`,
      );
    }
    // Nothing the template does not import.
    assert.equal(manifest.dependencies["glove-lisp"], undefined);
    assert.equal(manifest.dependencies["glove-python"], undefined);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("the minimal template is one agent and one tool", async () => {
  const parent = await workspace();
  const directory = join(parent, "small");
  try {
    const result = await scaffoldFoundryProject({ directory, template: "minimal" });
    assert.equal(result.agentRoute, "assistant");
    assert.ok(result.files.includes("agents/assistant/agent.ts"));
    assert.ok(result.files.includes("agents/assistant/tools/current-time.tool.ts"));
    assert.equal(
      result.files.some((file) => file.includes("transmissions/")),
      false,
      "the minimal template stays minimal",
    );
    const manifest = JSON.parse(
      await readFile(join(directory, "package.json"), "utf8"),
    ) as { dependencies: Record<string, string> };
    // No REPL in this template, so no REPL package.
    assert.equal(manifest.dependencies["glove-js"], undefined);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("an unknown template is refused by name", async () => {
  const parent = await workspace();
  try {
    await assert.rejects(
      scaffoldFoundryProject({
        directory: join(parent, "x"),
        template: "nope" as never,
      }),
      /Unknown Foundry template/,
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("Foundry joins an existing Next.js app without disturbing it", async () => {
  const parent = await workspace();
  const directory = join(parent, "site");
  try {
    await mkdir(join(directory, "app"), { recursive: true });
    await writeFile(
      join(directory, "package.json"),
      `${JSON.stringify(
        {
          name: "my-site",
          version: "2.1.0",
          private: true,
          scripts: { dev: "next dev", build: "next build" },
          dependencies: { next: "^16.3.3", react: "^19.2.0" },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(join(directory, "next.config.mjs"), "export default {};\n", "utf8");
    await writeFile(join(directory, "app/page.tsx"), "export default function P() {}\n", "utf8");

    const result = await scaffoldFoundryProject({ directory, packageManager: "npm" });
    assert.equal(result.target, "nextjs", "a Next.js app is detected, not assumed");
    assert.equal(result.agentsDir, "foundry/agents");

    // Agents are co-located under foundry/, and the app keeps its own root.
    assert.ok(result.files.includes("foundry/agents/concierge/agent.ts"));
    assert.ok(result.files.includes("lib/foundry.ts"));
    assert.ok(result.files.includes("app/api/concierge/route.ts"));
    assert.equal(result.files.includes("README.md"), false, "the app keeps its README");
    assert.equal(result.files.includes("tsconfig.json"), false, "the app keeps its tsconfig");
    assert.equal(result.files.includes("src/client.ts"), false, "lib/foundry.ts replaces it");

    // A Next.js app is not "type": "module", so Node would load these through
    // the CJS resolver and fail on Foundry's ESM-only export map.
    assert.ok(result.files.includes("foundry.config.mts"));
    assert.equal(result.files.includes("foundry.config.ts"), false);
    const scoped = JSON.parse(
      await readFile(join(directory, "foundry/package.json"), "utf8"),
    ) as { type: string };
    assert.equal(scoped.type, "module");

    const config = await readFile(join(directory, "foundry.config.mts"), "utf8");
    assert.match(config, /agentsDir: "foundry\/agents"/);
    assert.match(config, /applicationFile: "foundry\/foundry\.application\.ts"/);

    const routes = await readFile(join(directory, ".foundry/routes.d.ts"), "utf8");
    assert.match(routes, /import\("\.\.\/foundry\/agents\/concierge\/agent\.js"\)/);

    // The app's own manifest keeps everything it had.
    const manifest = JSON.parse(
      await readFile(join(directory, "package.json"), "utf8"),
    ) as {
      name: string;
      version: string;
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
    };
    assert.equal(manifest.name, "my-site");
    assert.equal(manifest.version, "2.1.0");
    assert.equal(manifest.scripts.dev, "next dev", "the app's dev script is untouched");
    assert.equal(manifest.scripts.build, "next build");
    assert.equal(manifest.scripts["foundry:dev"], "glove foundry dev");
    assert.equal(manifest.dependencies.next, "^16.3.3");
    assert.equal(manifest.dependencies.react, "^19.2.0");
    assert.ok(manifest.dependencies["glove-foundry"]);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("joining an existing app never overwrites a file it already owns", async () => {
  const parent = await workspace();
  const directory = join(parent, "site");
  try {
    await mkdir(join(directory, "lib"), { recursive: true });
    await writeFile(
      join(directory, "package.json"),
      `${JSON.stringify({ name: "s", dependencies: { next: "^16.3.3" } }, null, 2)}\n`,
      "utf8",
    );
    const mine = "export const foundry = 'do not clobber me';\n";
    await writeFile(join(directory, "lib/foundry.ts"), mine, "utf8");

    await scaffoldFoundryProject({ directory, target: "nextjs" });
    assert.equal(await readFile(join(directory, "lib/foundry.ts"), "utf8"), mine);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
