import z from "zod";
import { readFile, writeFile, readdir, mkdir, lstat } from "fs/promises";
import { exec } from "child_process";
import { join, resolve, relative } from "path";
import type { Tool } from "glove-core";

function execAsync(
  cmd: string,
  opts?: { cwd?: string; timeout?: number; maxBuffer?: number },
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    exec(
      cmd,
      {
        maxBuffer: opts?.maxBuffer ?? 1024 * 1024 * 5,
        timeout: opts?.timeout,
        cwd: opts?.cwd,
        shell: "/bin/bash",
      },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          code: error ? (error.code ?? 1) : 0,
        });
      },
    );
  });
}

// ─── ReadFile ─────────────────────────────────────────────────────────────────

export const readFileTool: Tool<{
  path: string;
  start_line?: number;
  end_line?: number;
}> = {
  name: "read_file",
  description: `Read the contents of a file. Returns the file text with line numbers prepended.
Optionally specify a line range to read only a portion of the file — useful for large files.
If the file does not exist, returns an error.`,
  input_schema: z.object({
    path: z.string().describe("Absolute or relative path to the file to read"),
    start_line: z
      .number()
      .optional()
      .describe("1-indexed start line. Omit to read from the beginning"),
    end_line: z
      .number()
      .optional()
      .describe("1-indexed end line (inclusive). Omit to read to the end"),
  }),
  async run(input) {
    const content = await readFile(input.path, "utf-8");
    const allLines = content.split("\n");

    const start = (input.start_line ?? 1) - 1;
    const end = input.end_line ?? allLines.length;
    const lines = allLines.slice(start, end);

    const numbered = lines
      .map((line, i) => `${start + i + 1} | ${line}`)
      .join("\n");

    const total = allLines.length;
    const showing =
      input.start_line || input.end_line
        ? ` (showing lines ${start + 1}-${Math.min(end, total)} of ${total})`
        : ` (${total} lines)`;

    return `${input.path}${showing}\n${numbered}`;
  },
};

// ─── WriteFile ────────────────────────────────────────────────────────────────

export const writeFileTool: Tool<{
  path: string;
  content: string;
  create_dirs?: boolean;
}> = {
  name: "write_file",
  description: `Create a new file or overwrite an existing one with the provided content.
Use this for creating new files. For modifying existing files, prefer edit_file instead.
Set create_dirs to true to automatically create parent directories if they don't exist.`,
  input_schema: z.object({
    path: z.string().describe("Path to the file to create or overwrite"),
    content: z.string().describe("The full content to write to the file"),
    create_dirs: z
      .boolean()
      .optional()
      .describe("Create parent directories if they don't exist. Defaults to false"),
  }),
  async run(input) {
    if (input.create_dirs) {
      const dir = input.path.substring(0, input.path.lastIndexOf("/"));
      if (dir) {
        await mkdir(dir, { recursive: true });
      }
    }

    await writeFile(input.path, input.content, "utf-8");
    const lineCount = input.content.split("\n").length;
    return `Wrote ${lineCount} lines to ${input.path}`;
  },
};

// ─── EditFile ─────────────────────────────────────────────────────────────────

export const editFileTool: Tool<{
  path: string;
  old_string: string;
  new_string: string;
}> = {
  name: "edit_file",
  description: `Make a surgical edit to an existing file by replacing a specific string with a new one.
The old_string must appear EXACTLY ONCE in the file — including whitespace and indentation.
This is the preferred way to modify files. Use read_file first to see the exact content.

Tips:
- Include enough surrounding context in old_string to make it unique
- Preserve the original indentation in both old_string and new_string
- To delete code, set new_string to an empty string
- To insert code, include surrounding lines in old_string and add the new code in new_string`,
  input_schema: z.object({
    path: z.string().describe("Path to the file to edit"),
    old_string: z
      .string()
      .describe(
        "The exact string to find and replace. Must appear exactly once in the file",
      ),
    new_string: z
      .string()
      .describe("The string to replace old_string with. Use empty string to delete"),
  }),
  async run(input) {
    const content = await readFile(input.path, "utf-8");

    const occurrences = content.split(input.old_string).length - 1;

    if (occurrences === 0) {
      throw new Error(
        `old_string not found in ${input.path}. Use read_file to see the current file content and make sure your string matches exactly.`,
      );
    }

    if (occurrences > 1) {
      throw new Error(
        `old_string found ${occurrences} times in ${input.path}. It must appear exactly once. Include more surrounding context to make it unique.`,
      );
    }

    const newContent = content.replace(input.old_string, input.new_string);
    await writeFile(input.path, newContent, "utf-8");

    const lines = newContent.split("\n");
    const editStart = content.indexOf(input.old_string);
    const lineNumber = content.substring(0, editStart).split("\n").length;

    const previewStart = Math.max(0, lineNumber - 3);
    const previewEnd = Math.min(
      lines.length,
      lineNumber + input.new_string.split("\n").length + 2,
    );

    const preview = lines
      .slice(previewStart, previewEnd)
      .map((line, i) => `${previewStart + i + 1} | ${line}`)
      .join("\n");

    return `Edited ${input.path}\n\nContext around edit:\n${preview}`;
  },
};

// ─── ListDir ──────────────────────────────────────────────────────────────────

export const listDirTool: Tool<{
  path: string;
  max_depth?: number;
}> = {
  name: "list_dir",
  description: `List files and directories at the given path. Returns a tree-like structure.
Hidden files (starting with .) and node_modules are excluded by default.
Use max_depth to control how deep to recurse (default: 2).`,
  input_schema: z.object({
    path: z.string().describe("Path to the directory to list"),
    max_depth: z
      .number()
      .optional()
      .describe("Maximum depth to recurse. Defaults to 2"),
  }),
  async run(input) {
    const maxDepth = input.max_depth ?? 2;
    const basePath = resolve(input.path);
    const lines: string[] = [];

    const IGNORE = new Set([
      "node_modules",
      ".git",
      ".next",
      ".cache",
      "dist",
      "__pycache__",
      ".turbo",
    ]);

    async function walk(dir: string, depth: number, prefix: string) {
      if (depth > maxDepth) return;

      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];

        if (entry.name.startsWith(".") || IGNORE.has(entry.name)) continue;

        const isLast = i === entries.length - 1;
        const connector = isLast ? "└── " : "├── ";
        const childPrefix = isLast ? "    " : "│   ";

        if (entry.isDirectory()) {
          lines.push(`${prefix}${connector}${entry.name}/`);
          await walk(join(dir, entry.name), depth + 1, prefix + childPrefix);
        } else {
          lines.push(`${prefix}${connector}${entry.name}`);
        }
      }
    }

    lines.push(`${relative(process.cwd(), basePath) || "."}/`);
    await walk(basePath, 1, "");

    return lines.join("\n") || "Empty directory";
  },
};

// ─── Search (grep) ────────────────────────────────────────────────────────────

export const searchTool: Tool<{
  pattern: string;
  path: string;
  file_glob?: string;
  max_results?: number;
}> = {
  name: "search",
  description: `Search for a regex pattern across files in a directory. Returns matching lines with file paths and line numbers.
Useful for finding function definitions, usages, imports, TODOs, etc.
Searches recursively. Skips binary files, node_modules, and .git.`,
  input_schema: z.object({
    pattern: z.string().describe("Regex pattern to search for"),
    path: z
      .string()
      .describe("Directory to search in. Use '.' for current directory"),
    file_glob: z
      .string()
      .optional()
      .describe(
        "Optional file extension filter like '*.ts' or '*.py'. Searches all text files by default",
      ),
    max_results: z
      .number()
      .optional()
      .describe("Maximum number of matches to return. Defaults to 50"),
  }),
  async run(input) {
    const maxResults = input.max_results ?? 50;

    return new Promise<string>((resolve) => {
      const globArg = input.file_glob ? `--glob '${input.file_glob}'` : "";
      const rgCmd = `rg --line-number --no-heading --max-count ${maxResults} ${globArg} '${input.pattern}' '${input.path}' 2>/dev/null`;
      const grepCmd = `grep -rn --max-count=${maxResults} ${input.file_glob ? `--include='${input.file_glob}'` : ""} '${input.pattern}' '${input.path}' 2>/dev/null`;

      exec(rgCmd, { maxBuffer: 1024 * 1024 }, (rgErr, rgOut) => {
        if (!rgErr && rgOut.trim()) {
          const lines = rgOut.trim().split("\n");
          resolve(
            `Found ${lines.length} match(es):\n${lines.slice(0, maxResults).join("\n")}`,
          );
          return;
        }

        exec(grepCmd, { maxBuffer: 1024 * 1024 }, (grepErr, grepOut) => {
          if (!grepErr && grepOut.trim()) {
            const lines = grepOut.trim().split("\n");
            resolve(
              `Found ${lines.length} match(es):\n${lines.slice(0, maxResults).join("\n")}`,
            );
            return;
          }

          resolve(`No matches found for pattern "${input.pattern}" in ${input.path}`);
        });
      });
    });
  },
};

// ─── Bash ─────────────────────────────────────────────────────────────────────

export const bashTool: Tool<{
  command: string;
  working_dir?: string;
  timeout?: number;
}> = {
  name: "bash",
  description: `Execute a shell command and return its output (stdout + stderr).
Use this for:
- Running code (node, python, etc.)
- Installing packages (npm install, pip install)
- Git operations
- File operations that are easier with shell commands
- Running tests
- Any system command

The command runs in a bash shell. Timeout defaults to 30 seconds.
For long-running processes, increase the timeout.
IMPORTANT: Commands that require interactive input will hang — avoid them.`,
  input_schema: z.object({
    command: z.string().describe("The shell command to execute"),
    working_dir: z
      .string()
      .optional()
      .describe("Working directory for the command. Defaults to current directory"),
    timeout: z
      .number()
      .optional()
      .describe("Timeout in seconds. Defaults to 30"),
  }),
  async run(input) {
    const timeout = (input.timeout ?? 30) * 1000;

    return new Promise<string>((resolve) => {
      exec(
        input.command,
        {
          cwd: input.working_dir,
          timeout,
          maxBuffer: 1024 * 1024 * 5,
          shell: "/bin/bash",
        },
        (error, stdout, stderr) => {
          const parts: string[] = [];

          if (stdout.trim()) {
            parts.push(`stdout:\n${stdout.trim()}`);
          }

          if (stderr.trim()) {
            parts.push(`stderr:\n${stderr.trim()}`);
          }

          if (error && error.killed) {
            parts.push(`\nProcess timed out after ${input.timeout ?? 30}s`);
          } else if (error) {
            parts.push(`\nExit code: ${error.code ?? 1}`);
          } else {
            parts.push(`\nExit code: 0`);
          }

          resolve(parts.join("\n\n") || "Command produced no output");
        },
      );
    });
  },
};

// ─── Glob ────────────────────────────────────────────────────────────────────

export const globTool: Tool<{
  pattern: string;
  path?: string;
  max_results?: number;
}> = {
  name: "glob",
  description: `Find files matching a glob pattern. Uses 'find' under the hood.
Useful for locating files by name or extension across a directory tree.
Examples: "*.ts", "src/**/*.test.ts", "package.json"
Skips node_modules, .git, dist, and other common ignore directories.`,
  input_schema: z.object({
    pattern: z
      .string()
      .describe('Glob pattern to match, e.g. "*.ts" or "**/*.test.js"'),
    path: z
      .string()
      .optional()
      .describe("Root directory to search from. Defaults to current directory"),
    max_results: z
      .number()
      .optional()
      .describe("Maximum number of results. Defaults to 100"),
  }),
  async run(input) {
    const maxResults = input.max_results ?? 100;
    const searchPath = input.path ?? ".";
    const { stdout } = await execAsync(
      `find ${JSON.stringify(searchPath)} ` +
        `-not -path '*/node_modules/*' -not -path '*/.git/*' ` +
        `-not -path '*/dist/*' -not -path '*/__pycache__/*' ` +
        `-not -path '*/.next/*' -not -path '*/.cache/*' ` +
        `-name ${JSON.stringify(input.pattern)} -type f 2>/dev/null | head -n ${maxResults}`,
    );

    const files = stdout.trim().split("\n").filter(Boolean);
    if (files.length === 0) {
      return `No files matching "${input.pattern}" found in ${searchPath}`;
    }
    return `Found ${files.length} file(s):\n${files.join("\n")}`;
  },
};

// ─── Grep (enhanced) ─────────────────────────────────────────────────────────

export const grepTool: Tool<{
  pattern: string;
  path: string;
  output_mode?: "content" | "files" | "count";
  context_lines?: number;
  case_insensitive?: boolean;
  file_glob?: string;
}> = {
  name: "grep",
  description: `Search for a regex pattern across files. More powerful than 'search' with output modes.

Output modes:
- "content" (default): Show matching lines with file paths, line numbers, and optional context
- "files": Show only file paths that contain a match
- "count": Show match count per file

Skips binary files, node_modules, and .git.`,
  input_schema: z.object({
    pattern: z.string().describe("Regex pattern to search for"),
    path: z
      .string()
      .describe("Directory or file to search in. Use '.' for current directory"),
    output_mode: z
      .enum(["content", "files", "count"])
      .optional()
      .describe('Output mode: "content", "files", or "count". Defaults to "content"'),
    context_lines: z
      .number()
      .optional()
      .describe("Number of context lines to show around each match (only for content mode)"),
    case_insensitive: z
      .boolean()
      .optional()
      .describe("Case insensitive search. Defaults to false"),
    file_glob: z
      .string()
      .optional()
      .describe("File pattern filter, e.g. '*.ts' or '*.py'"),
  }),
  async run(input) {
    const mode = input.output_mode ?? "content";

    const flags: string[] = ["--line-number", "--no-heading"];
    if (input.case_insensitive) flags.push("-i");
    if (input.file_glob) flags.push(`--glob '${input.file_glob}'`);

    switch (mode) {
      case "files":
        flags.push("--files-with-matches");
        break;
      case "count":
        flags.push("--count");
        break;
      case "content":
        if (input.context_lines != null) flags.push(`-C ${input.context_lines}`);
        break;
    }

    const rgCmd = `rg ${flags.join(" ")} -- ${JSON.stringify(input.pattern)} ${JSON.stringify(input.path)} 2>/dev/null`;
    const { stdout, code } = await execAsync(rgCmd);

    if (code !== 0 || !stdout.trim()) {
      // Fallback to grep
      const gFlags: string[] = ["-rn"];
      if (input.case_insensitive) gFlags.push("-i");
      if (input.file_glob) gFlags.push(`--include='${input.file_glob}'`);
      if (mode === "files") gFlags.push("-l");
      if (mode === "count") gFlags.push("-c");
      if (mode === "content" && input.context_lines != null)
        gFlags.push(`-C ${input.context_lines}`);

      const grepCmd = `grep ${gFlags.join(" ")} -- ${JSON.stringify(input.pattern)} ${JSON.stringify(input.path)} 2>/dev/null`;
      const fallback = await execAsync(grepCmd);

      if (!fallback.stdout.trim()) {
        return `No matches found for "${input.pattern}" in ${input.path}`;
      }
      return fallback.stdout.trim();
    }

    return stdout.trim();
  },
};

// ─── FileInfo ────────────────────────────────────────────────────────────────

export const fileInfoTool: Tool<{ path: string }> = {
  name: "file_info",
  description: `Get metadata about a file or directory: size, modification date, type, permissions, and line count (for files).`,
  input_schema: z.object({
    path: z.string().describe("Path to the file or directory"),
  }),
  async run(input) {
    const info = await lstat(input.path);
    const type = info.isDirectory()
      ? "directory"
      : info.isSymbolicLink()
        ? "symlink"
        : "file";

    const lines: string[] = [
      `Path: ${input.path}`,
      `Type: ${type}`,
      `Size: ${info.size} bytes`,
      `Modified: ${info.mtime.toISOString()}`,
      `Created: ${info.birthtime.toISOString()}`,
      `Permissions: ${(info.mode & 0o777).toString(8)}`,
    ];

    if (type === "file") {
      try {
        const content = await readFile(input.path, "utf-8");
        lines.push(`Lines: ${content.split("\n").length}`);
      } catch {
        // binary file or read error
      }
    }

    return lines.join("\n");
  },
};

// ─── Git Status ──────────────────────────────────────────────────────────────

export const gitStatusTool: Tool<{ cwd?: string }> = {
  name: "git_status",
  description: `Show the current git working tree status: modified, staged, and untracked files.`,
  input_schema: z.object({
    cwd: z.string().optional().describe("Working directory for git commands"),
  }),
  async run(input) {
    const { stdout, stderr, code } = await execAsync("git status --short 2>&1", { cwd: input.cwd });
    if (code !== 0) {
      return `git error: ${stderr || stdout}`;
    }
    return stdout.trim() || "Working tree clean";
  },
};

// ─── Git Diff ────────────────────────────────────────────────────────────────

export const gitDiffTool: Tool<{
  file?: string;
  staged?: boolean;
  cwd?: string;
}> = {
  name: "git_diff",
  description: `Show git diff output. By default shows unstaged changes.
Set staged=true to see staged (--cached) changes.
Optionally specify a file path to limit the diff.`,
  input_schema: z.object({
    file: z
      .string()
      .optional()
      .describe("Specific file to diff. Omit for all changes"),
    staged: z
      .boolean()
      .optional()
      .describe("Show staged changes (--cached). Defaults to false"),
    cwd: z.string().optional().describe("Working directory for git commands"),
  }),
  async run(input) {
    const parts = ["git", "diff"];
    if (input.staged) parts.push("--cached");
    if (input.file) parts.push(JSON.stringify(input.file));

    const { stdout, stderr, code } = await execAsync(parts.join(" ") + " 2>&1", { cwd: input.cwd });
    if (code !== 0) {
      return `git error: ${stderr || stdout}`;
    }
    return stdout.trim() || "No differences";
  },
};

// ─── Git Log ─────────────────────────────────────────────────────────────────

export const gitLogTool: Tool<{
  max_count?: number;
  file?: string;
  oneline?: boolean;
  cwd?: string;
}> = {
  name: "git_log",
  description: `Show git commit history. Returns recent commits with hash, author, date, and message.
Use oneline=true for a compact single-line-per-commit format.`,
  input_schema: z.object({
    max_count: z
      .number()
      .optional()
      .describe("Maximum number of commits to show. Defaults to 20"),
    file: z
      .string()
      .optional()
      .describe("Show commits affecting this file only"),
    oneline: z
      .boolean()
      .optional()
      .describe("Compact one-line format. Defaults to false"),
    cwd: z.string().optional().describe("Working directory for git commands"),
  }),
  async run(input) {
    const count = input.max_count ?? 20;
    const parts = ["git", "log", `--max-count=${count}`];
    if (input.oneline) {
      parts.push("--oneline");
    } else {
      parts.push('--format=%h %an %ad %s', "--date=short");
    }
    if (input.file) parts.push("--", JSON.stringify(input.file));

    const { stdout, stderr, code } = await execAsync(parts.join(" ") + " 2>&1", { cwd: input.cwd });
    if (code !== 0) {
      return `git error: ${stderr || stdout}`;
    }
    return stdout.trim() || "No commits found";
  },
};

// ─── Plan ─────────────────────────────────────────────────────────────────────

export const planTool: Tool<{
  title: string;
  steps: string[];
  summary?: string;
}> = {
  name: "plan",
  description: `Present a plan to the user for approval before executing.
Use this tool when the user asks you to plan first, or when a task involves multiple steps or significant changes and you want to confirm your approach.

The plan is displayed as a titled list of concrete steps. The user can:
- **Approve**: You should proceed with execution
- **Reject**: Stop and ask what they'd like instead
- **Modify**: Revise the plan based on their feedback and present it again

Returns a JSON object: { "action": "approve" | "reject" | "modify", "feedback"?: "..." }`,
  input_schema: z.object({
    title: z.string().describe("Short title summarizing the plan"),
    steps: z
      .array(z.string())
      .describe("Ordered list of concrete steps to execute"),
    summary: z
      .string()
      .optional()
      .describe("Optional brief summary of the overall approach"),
  }),
  async run(input, handOver) {
    if (!handOver) {
      return JSON.stringify({
        action: "approve",
        note: "No interactive display available — auto-approved",
      });
    }

    const result = await handOver({
      renderer: "plan_approval",
      title: input.title,
      steps: input.steps,
      summary: input.summary,
    });

    return JSON.stringify(result);
  },
};

// ─── Ask Question ─────────────────────────────────────────────────────────────

export const askQuestionTool: Tool<{
  questions: Array<{ question: string; options?: string[] }>;
}> = {
  name: "ask_question",
  description: `Ask the user one or more questions and wait for their responses.
Use this when you need clarification, choices between alternatives, or any input from the user before proceeding.

Each question can optionally include quick-select options. The user always has a free-text field as well.

Returns a JSON array of answers in the same order as the questions.`,
  input_schema: z.object({
    questions: z
      .array(
        z.object({
          question: z.string().describe("The question to ask"),
          options: z
            .array(z.string())
            .optional()
            .describe("Optional quick-select choices"),
        }),
      )
      .min(1)
      .describe("One or more questions to ask the user"),
  }),
  async run(input, handOver) {
    if (!handOver) {
      return "No interactive display available — cannot ask questions";
    }

    const result = await handOver({
      renderer: "ask_question",
      questions: input.questions,
    });

    return JSON.stringify(result);
  },
};

// ─── Export all ───────────────────────────────────────────────────────────────

export const codingTools = [
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirTool,
  searchTool,
  bashTool,
];

/** Non-interactive tools only — for server use where plan/ask_question are registered via DisplayManager */
export const baseTools = [
  ...codingTools,
  globTool,
  grepTool,
  fileInfoTool,
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
];

export const allTools = [
  ...baseTools,
  planTool,
  askQuestionTool,
];
