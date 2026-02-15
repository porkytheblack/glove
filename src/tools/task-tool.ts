import z from "zod";
import type { Tool, Context, Task } from "../core";

const TaskItemSchema = z.object({
  content: z.string().min(1),
  activeForm: z.string().min(1),
  status: z.enum(["pending", "in_progress", "completed"]),
});

const TaskToolInputSchema = z.object({
  todos: z.array(TaskItemSchema),
});

type TaskToolInput = z.infer<typeof TaskToolInputSchema>;

export function createTaskTool(context: Context): Tool<TaskToolInput> {
  return {
    name: "glove_update_tasks",
    description:
      `Use this tool to create and manage a structured task list for the current session. ` +
      `Call this tool with the FULL updated list of tasks each time. Each task has:\n` +
      `- content: imperative form describing the task ("Fix the bug", "Run tests")\n` +
      `- activeForm: present continuous form shown during execution ("Fixing the bug", "Running tests")\n` +
      `- status: "pending", "in_progress", or "completed"\n\n` +
      `Only one task should be in_progress at a time. Mark tasks completed immediately after finishing them.`,
    input_schema: TaskToolInputSchema,
    async run(input: TaskToolInput) {
      const currentTasks = await context.getTasks();

      const updatedTasks: Task[] = input.todos.map((todo, index) => {
        const existing = currentTasks.find((t) => t.content === todo.content);
        return {
          id: existing?.id ?? `task_${Date.now()}_${index}`,
          content: todo.content,
          activeForm: todo.activeForm,
          status: todo.status,
        };
      });

      await context.addTasks(updatedTasks);

      return { status: "success", tasks: updatedTasks };
    },
  };
}
