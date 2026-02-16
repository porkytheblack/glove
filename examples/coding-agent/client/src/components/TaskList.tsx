import { useMemo } from "react";
import type { Task, TaskStatus } from "../hooks/useAgent";

/**
 * TaskList - displays agent task progress with a visual progress bar
 * and clear status indicators for each task.
 *
 * Design decisions:
 * - Progress bar at the top gives instant scan-ability of overall completion
 * - Task states use distinct icons and colors: pending (dim circle),
 *   in_progress (animated pulse), completed (green check)
 * - Completed tasks are visually de-emphasized but not hidden
 * - In-progress tasks are highlighted to draw the eye
 */
export function TaskList({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) return null;

  const stats = useMemo(() => {
    const completed = tasks.filter((t) => t.status === "completed").length;
    const inProgress = tasks.filter((t) => t.status === "in_progress").length;
    const total = tasks.length;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { completed, inProgress, total, percent };
  }, [tasks]);

  return (
    <div className="task-list" role="region" aria-label="Task progress">
      <div className="task-list-header">
        <span className="task-list-title">Tasks</span>
        <span className="task-list-count">
          {stats.completed}/{stats.total}
        </span>
      </div>

      {/* Progress bar */}
      <div
        className="task-progress-bar"
        role="progressbar"
        aria-valuenow={stats.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${stats.percent}% complete`}
      >
        <div
          className="task-progress-fill"
          style={{ width: `${stats.percent}%` }}
        />
      </div>

      <div className="task-items">
        {tasks.map((task) => (
          <div
            key={task.id}
            className={`task task-${task.status}`}
          >
            <TaskIcon status={task.status} />
            <span className="task-text">
              {task.status === "in_progress" ? task.activeForm : task.content}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TaskIcon({ status }: { status: TaskStatus }) {
  if (status === "completed") {
    return (
      <span className="task-icon" aria-label="Completed">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="6" stroke="var(--green)" strokeWidth="1.5" />
          <path d="M4.5 7l2 2 3-3.5" stroke="var(--green)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </span>
    );
  }

  if (status === "in_progress") {
    return (
      <span className="task-icon task-icon-pulse" aria-label="In progress">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="6" stroke="var(--accent)" strokeWidth="1.5" />
          <circle cx="7" cy="7" r="2.5" fill="var(--accent)" />
        </svg>
      </span>
    );
  }

  return (
    <span className="task-icon" aria-label="Pending">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="7" cy="7" r="6" stroke="var(--text-dim)" strokeWidth="1.5" />
      </svg>
    </span>
  );
}
