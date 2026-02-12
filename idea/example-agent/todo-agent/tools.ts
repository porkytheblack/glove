import z from "zod";
import { readFile, writeFile, access } from "fs/promises";
import type { Tool } from "../../core";

// ─── Markdown format ──────────────────────────────────────────────────────────
//
// The file looks like:
//
// # Todo
//
// - [ ] Buy groceries
// - [x] Walk the dog
// - [ ] Fix the auth bug #high
//

const DEFAULT_PATH = "./todo.md";

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface TodoItem {
  index: number;
  text: string;
  done: boolean;
  raw: string;
}

async function ensureFile(path: string): Promise<void> {
  try {
    await access(path);
  } catch {
    await writeFile(path, "# Todo\n\n", "utf-8");
  }
}

async function parseTodos(path: string): Promise<TodoItem[]> {
  await ensureFile(path);
  const content = await readFile(path, "utf-8");
  const lines = content.split("\n");
  const todos: TodoItem[] = [];
  let index = 0;

  for (const line of lines) {
    const match = line.match(/^- \[([ xX])\] (.+)$/);
    if (match) {
      todos.push({
        index,
        text: match[2].trim(),
        done: match[1] !== " ",
        raw: line,
      });
      index++;
    }
  }

  return todos;
}

async function writeTodos(path: string, todos: TodoItem[]): Promise<void> {
  const lines = [
    "# Todo",
    "",
    ...todos.map((t) => `- [${t.done ? "x" : " "}] ${t.text}`),
    "", // trailing newline
  ];
  await writeFile(path, lines.join("\n"), "utf-8");
}

// ─── Tools ────────────────────────────────────────────────────────────────────

export const readTodosTool: Tool<{ path?: string }> = {
  name: "read_todos",
  description:
    "Read all todo items from the markdown file. Returns the full list with index numbers, text, and completion status. Use this before modifying todos so you know the current state.",
  input_schema: z.object({
    path: z
      .string()
      .optional()
      .describe("Path to the todo markdown file. Defaults to ./todo.md"),
  }),
  async run(input) {
    const path = input.path ?? DEFAULT_PATH;
    const todos = await parseTodos(path);

    if (todos.length === 0) {
      return "The todo list is empty.";
    }

    const formatted = todos
      .map(
        (t) =>
          `${t.index}. [${t.done ? "x" : " "}] ${t.text}`
      )
      .join("\n");

    return `Found ${todos.length} todo(s):\n${formatted}`;
  },
};

export const addTodoTool: Tool<{ text: string; path?: string }> = {
  name: "add_todo",
  description:
    "Add a new todo item to the markdown file. The item is added as uncompleted. You can add tags like #high or #low at the end of the text for priority.",
  input_schema: z.object({
    text: z.string().describe("The todo item text to add"),
    path: z
      .string()
      .optional()
      .describe("Path to the todo markdown file. Defaults to ./todo.md"),
  }),
  async run(input) {
    const path = input.path ?? DEFAULT_PATH;
    const todos = await parseTodos(path);

    todos.push({
      index: todos.length,
      text: input.text,
      done: false,
      raw: `- [ ] ${input.text}`,
    });

    await writeTodos(path, todos);
    return `Added todo: "${input.text}" (index ${todos.length - 1})`;
  },
};

export const completeTodoTool: Tool<{ index: number; path?: string }> = {
  name: "complete_todo",
  description:
    "Mark a todo item as completed by its index number. Use read_todos first to see the current indexes.",
  input_schema: z.object({
    index: z.number().describe("The index of the todo item to mark as complete"),
    path: z
      .string()
      .optional()
      .describe("Path to the todo markdown file. Defaults to ./todo.md"),
  }),
  async run(input) {
    const path = input.path ?? DEFAULT_PATH;
    const todos = await parseTodos(path);

    if (input.index < 0 || input.index >= todos.length) {
      throw new Error(
        `Index ${input.index} out of range. There are ${todos.length} todos (0-${todos.length - 1}).`
      );
    }

    if (todos[input.index].done) {
      return `Todo "${todos[input.index].text}" is already completed.`;
    }

    todos[input.index].done = true;
    await writeTodos(path, todos);
    return `Completed: "${todos[input.index].text}"`;
  },
};

export const removeTodoTool: Tool<{ index: number; path?: string }> = {
  name: "remove_todo",
  description:
    "Remove a todo item entirely by its index number. This deletes it from the file. Use read_todos first to see the current indexes.",
  input_schema: z.object({
    index: z.number().describe("The index of the todo item to remove"),
    path: z
      .string()
      .optional()
      .describe("Path to the todo markdown file. Defaults to ./todo.md"),
  }),
  async run(input) {
    const path = input.path ?? DEFAULT_PATH;
    const todos = await parseTodos(path);

    if (input.index < 0 || input.index >= todos.length) {
      throw new Error(
        `Index ${input.index} out of range. There are ${todos.length} todos (0-${todos.length - 1}).`
      );
    }

    const removed = todos.splice(input.index, 1)[0];
    // Re-index after removal
    todos.forEach((t, i) => (t.index = i));
    await writeTodos(path, todos);
    return `Removed: "${removed.text}"`;
  },
};

export const editTodoTool: Tool<{
  index: number;
  newText: string;
  path?: string;
}> = {
  name: "edit_todo",
  description:
    "Edit the text of an existing todo item by its index number. Use read_todos first to see the current indexes.",
  input_schema: z.object({
    index: z.number().describe("The index of the todo item to edit"),
    newText: z.string().describe("The new text for the todo item"),
    path: z
      .string()
      .optional()
      .describe("Path to the todo markdown file. Defaults to ./todo.md"),
  }),
  async run(input) {
    const path = input.path ?? DEFAULT_PATH;
    const todos = await parseTodos(path);

    if (input.index < 0 || input.index >= todos.length) {
      throw new Error(
        `Index ${input.index} out of range. There are ${todos.length} todos (0-${todos.length - 1}).`
      );
    }

    const old = todos[input.index].text;
    todos[input.index].text = input.newText;
    await writeTodos(path, todos);
    return `Updated todo ${input.index}: "${old}" → "${input.newText}"`;
  },
};

/** All todo tools as an array, ready to register with the Executor */
export const todoTools = [
  readTodosTool,
  addTodoTool,
  completeTodoTool,
  removeTodoTool,
  editTodoTool,
];