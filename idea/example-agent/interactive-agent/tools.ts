import z from "zod";
import type { Tool } from "../../core";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// These tools all use the `handOver` callback to pause execution
// and ask the human for confirmation or additional input.
//
// The handOver function signature:
//   (input: unknown) => Promise<unknown>
//
// Convention: tools send a { type, message, ...options } object
// and receive the human's response back.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ─── Deploy Tool ─────────────────────────────────────────────────────────────
// Simulates deploying code. Asks human to confirm before "deploying".

export const deployTool: Tool<{
  service: string;
  environment: string;
  version?: string;
}> = {
  name: "deploy",
  description: `Deploy a service to an environment. This tool will ask the user for confirmation before proceeding.
Use this when the user wants to deploy code or services.`,
  input_schema: z.object({
    service: z.string().describe("Name of the service to deploy"),
    environment: z
      .string()
      .describe("Target environment: staging, production, dev"),
    version: z
      .string()
      .optional()
      .describe("Version tag to deploy. Defaults to 'latest'"),
  }),
  async run(input, handOver) {
    const version = input.version ?? "latest";

    // ── Step 1: Pre-flight checks (simulated) ─────────────────────
    const checks = [
      { name: "Build status", status: "passing" },
      { name: "Tests", status: "passing" },
      {
        name: "Lint",
        status: input.environment === "production" ? "1 warning" : "passing",
      },
    ];

    const checksReport = checks
      .map((c) => `  ${c.status === "passing" ? "✓" : "⚠"} ${c.name}: ${c.status}`)
      .join("\n");

    // ── Step 2: Ask human for confirmation ────────────────────────
    if (!handOver) {
      throw new Error(
        "Deploy requires human confirmation but no handOver callback is available."
      );
    }

    const answer = await handOver({
      type: "confirm",
      message:
        `About to deploy ${input.service}@${version} → ${input.environment}\n\n` +
        `Pre-flight checks:\n${checksReport}\n\n` +
        `Proceed with deployment?`,
      options: ["yes", "no", "dry-run"],
    });

    const response = String(answer).toLowerCase().trim();

    if (response === "no" || response === "n") {
      return `Deployment of ${input.service} to ${input.environment} was cancelled by user.`;
    }

    if (response === "dry-run" || response === "dry") {
      return (
        `[DRY RUN] Would deploy ${input.service}@${version} → ${input.environment}\n` +
        `Pre-flight:\n${checksReport}\n` +
        `No changes were made.`
      );
    }

    // ── Step 3: "Deploy" ──────────────────────────────────────────
    // Simulate deployment delay
    await new Promise((r) => setTimeout(r, 1500));

    return (
      `Successfully deployed ${input.service}@${version} → ${input.environment}\n` +
      `Pre-flight:\n${checksReport}\n` +
      `Deploy ID: deploy-${Date.now().toString(36)}\n` +
      `Status: live`
    );
  },
};

// ─── Scaffold Tool ───────────────────────────────────────────────────────────
// Creates a project from a template. Asks human for missing details.

export const scaffoldTool: Tool<{
  name: string;
  template: string;
  directory?: string;
}> = {
  name: "scaffold_project",
  description: `Scaffold a new project from a template. Will ask the user for any missing configuration details like description, author, license, etc.`,
  input_schema: z.object({
    name: z.string().describe("Project name"),
    template: z
      .string()
      .describe("Template to use: node-ts, react, express-api, cli-tool"),
    directory: z
      .string()
      .optional()
      .describe("Directory to create the project in. Defaults to ./<name>"),
  }),
  async run(input, handOver) {
    if (!handOver) {
      throw new Error("Scaffold requires human input but no handOver callback.");
    }

    // ── Step 1: Gather project details from human ─────────────────
    const description = await handOver({
      type: "input",
      message: `Description for "${input.name}":`,
      default: `A ${input.template} project`,
    });

    const author = await handOver({
      type: "input",
      message: "Author name:",
      default: "",
    });

    const license = await handOver({
      type: "select",
      message: "License:",
      options: ["MIT", "Apache-2.0", "GPL-3.0", "ISC", "Unlicensed"],
      default: "MIT",
    });

    // ── Step 2: Confirm before creating files ─────────────────────
    const summary =
      `Project: ${input.name}\n` +
      `Template: ${input.template}\n` +
      `Description: ${description}\n` +
      `Author: ${author}\n` +
      `License: ${license}\n` +
      `Directory: ${input.directory ?? `./${input.name}`}`;

    const confirm = await handOver({
      type: "confirm",
      message: `Create project with these settings?\n\n${summary}`,
      options: ["yes", "no"],
    });

    if (String(confirm).toLowerCase().startsWith("n")) {
      return "Project creation cancelled.";
    }

    // ── Step 3: Create the project (simulated) ────────────────────
    const dir = input.directory ?? `./${input.name}`;

    const packageJson = {
      name: input.name,
      version: "1.0.0",
      description: String(description),
      author: String(author),
      license: String(license),
      scripts: {
        build: "tsc",
        dev: "tsx watch src/index.ts",
        start: "node dist/index.js",
      },
    };

    // We won't actually write files — just return what would be created
    const files = [
      `${dir}/package.json`,
      `${dir}/tsconfig.json`,
      `${dir}/src/index.ts`,
      `${dir}/.gitignore`,
      `${dir}/README.md`,
    ];

    return (
      `Scaffolded project "${input.name}" with template "${input.template}"\n\n` +
      `Files created:\n${files.map((f) => `  📄 ${f}`).join("\n")}\n\n` +
      `package.json:\n${JSON.stringify(packageJson, null, 2)}\n\n` +
      `Next steps:\n  cd ${dir}\n  npm install\n  npm run dev`
    );
  },
};

// ─── Database Migration Tool ─────────────────────────────────────────────────
// Simulates running DB migrations with confirmation and rollback option.

export const migrateTool: Tool<{
  direction: string;
  steps?: number;
}> = {
  name: "db_migrate",
  description: `Run database migrations. Shows pending migrations and asks for confirmation before running.
Direction: 'up' to apply, 'down' to rollback. Steps defaults to all pending.`,
  input_schema: z.object({
    direction: z
      .string()
      .describe("'up' to apply pending migrations, 'down' to rollback"),
    steps: z
      .number()
      .optional()
      .describe("Number of migrations to apply. Defaults to all pending"),
  }),
  async run(input, handOver) {
    if (!handOver) {
      throw new Error("Migrations require human confirmation.");
    }

    // Simulated pending migrations
    const migrations =
      input.direction === "up"
        ? [
            { id: "001", name: "create_users_table", status: "pending" },
            { id: "002", name: "add_email_index", status: "pending" },
            { id: "003", name: "create_sessions_table", status: "pending" },
          ]
        : [
            { id: "003", name: "create_sessions_table", status: "applied" },
            { id: "002", name: "add_email_index", status: "applied" },
          ];

    const limit = input.steps ?? migrations.length;
    const toRun = migrations.slice(0, limit);

    const listing = toRun
      .map(
        (m) =>
          `  ${input.direction === "up" ? "↑" : "↓"} ${m.id}_${m.name}`
      )
      .join("\n");

    // ── Ask for confirmation ──────────────────────────────────────
    const confirm = await handOver({
      type: "confirm",
      message:
        `${input.direction === "up" ? "Apply" : "Rollback"} ${toRun.length} migration(s):\n\n${listing}\n\n` +
        `This will modify the database. Continue?`,
      options: ["yes", "no"],
    });

    if (String(confirm).toLowerCase().startsWith("n")) {
      return "Migration cancelled.";
    }

    // ── If rolling back, ask for extra confirmation ───────────────
    if (input.direction === "down") {
      const doubleCheck = await handOver({
        type: "confirm",
        message:
          `⚠️  Rolling back migrations is destructive and may cause data loss.\n` +
          `Type "rollback" to confirm:`,
        options: [],
      });

      if (String(doubleCheck).toLowerCase().trim() !== "rollback") {
        return "Rollback cancelled — confirmation string did not match.";
      }
    }

    // ── Run migrations (simulated) ────────────────────────────────
    const results: string[] = [];
    for (const m of toRun) {
      await new Promise((r) => setTimeout(r, 500));
      results.push(
        `  ✓ ${m.id}_${m.name} (${input.direction === "up" ? "applied" : "rolled back"})`
      );
    }

    return (
      `Migration complete.\n\n` +
      results.join("\n") +
      `\n\n${toRun.length} migration(s) ${input.direction === "up" ? "applied" : "rolled back"} successfully.`
    );
  },
};

// ─── Secret Injection Tool ───────────────────────────────────────────────────
// Asks user for secrets that shouldn't be stored in code/history.

export const secretTool: Tool<{
  key_name: string;
  target: string;
}> = {
  name: "inject_secret",
  description: `Securely inject a secret/API key into a target (env file, config, vault).
The tool will prompt the user to enter the secret value directly — the value never appears in chat history.`,
  input_schema: z.object({
    key_name: z
      .string()
      .describe("Name of the secret, e.g. DATABASE_URL, STRIPE_KEY"),
    target: z
      .string()
      .describe("Where to inject: '.env', 'config.json', 'vault'"),
  }),
  async run(input, handOver) {
    if (!handOver) {
      throw new Error("Secret injection requires human input.");
    }

    const value = await handOver({
      type: "secret",
      message: `Enter value for ${input.key_name}:`,
      sensitive: true,
    });

    const secretStr = String(value).trim();

    if (!secretStr) {
      return `No value provided for ${input.key_name}. Skipped.`;
    }

    // Simulated injection
    const masked =
      secretStr.slice(0, 4) + "•".repeat(Math.max(0, secretStr.length - 8)) + secretStr.slice(-4);

    return (
      `Injected ${input.key_name} into ${input.target}\n` +
      `Value: ${masked}\n` +
      `(Secret is stored securely and not visible in chat history)`
    );
  },
};

// ─── Multi-step Form Tool ────────────────────────────────────────────────────
// Collects structured data from the user through a series of questions.

export const formTool: Tool<{
  form_name: string;
  fields: Array<{ name: string; type: string; required: boolean }>;
}> = {
  name: "collect_form",
  description: `Collect structured information from the user by asking a series of questions.
Each field can be 'text', 'number', 'select', or 'confirm' type.
Use this when you need to gather multiple pieces of information from the user.`,
  input_schema: z.object({
    form_name: z.string().describe("Name/title of the form"),
    fields: z.array(
      z.object({
        name: z.string().describe("Field name"),
        type: z
          .string()
          .describe("Field type: text, number, select, confirm"),
        required: z.boolean().describe("Whether the field is required"),
      })
    ),
  }),
  async run(input, handOver) {
    if (!handOver) {
      throw new Error("Form collection requires human input.");
    }

    const responses: Record<string, unknown> = {};

    for (const field of input.fields) {
      const answer = await handOver({
        type: field.type === "confirm" ? "confirm" : "input",
        message: `${input.form_name} — ${field.name}${field.required ? " (required)" : ""}:`,
        field_name: field.name,
        field_type: field.type,
      });

      const value = String(answer).trim();

      if (field.required && !value) {
        // Ask again
        const retry = await handOver({
          type: "input",
          message: `${field.name} is required. Please enter a value:`,
          field_name: field.name,
        });
        responses[field.name] = String(retry).trim() || "(empty)";
      } else {
        responses[field.name] = value || "(empty)";
      }
    }

    const summary = Object.entries(responses)
      .map(([k, v]) => `  ${k}: ${v}`)
      .join("\n");

    return `Collected ${input.fields.length} field(s) for "${input.form_name}":\n\n${summary}`;
  },
};

// ─── Export ──────────────────────────────────────────────────────────────────

export const interactiveTools = [
  deployTool,
  scaffoldTool,
  migrateTool,
  secretTool,
  formTool,
];