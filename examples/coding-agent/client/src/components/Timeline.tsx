import { useState, useMemo } from "react";
import type { TimelineEntry } from "../hooks/useAgent";
import { Markdown } from "./Markdown";

/* -------------------------------------------------------------------------- */
/*  Utilities                                                                  */
/* -------------------------------------------------------------------------- */

function truncate(s: string, max: number) {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\u2026 (${s.length} chars)`;
}

function truncateLines(s: string, max: number) {
  const lines = s.split("\n");
  if (lines.length <= max) return s;
  return lines.slice(0, max).join("\n") + `\n\u2026 ${lines.length - max} more lines`;
}

function formatToolInput(name: string, input: any): string {
  if (!input) return "";
  switch (name) {
    case "read_file":
      return input.start_line
        ? `${input.path} L${input.start_line}-${input.end_line ?? "end"}`
        : input.path;
    case "write_file":
      return `${input.path} (${(input.content?.split("\n") ?? []).length} lines)`;
    case "edit_file":
      return input.path;
    case "list_dir":
      return input.path;
    case "search":
    case "grep":
      return `/${input.pattern}/ in ${input.path}`;
    case "glob":
      return `${input.pattern} in ${input.path ?? "."}`;
    case "bash":
      return truncate(input.command, 60);
    case "glove_update_tasks":
      return `${input.todos?.length ?? 0} task(s)`;
    case "git_status":
      return "";
    case "git_diff":
      return input.file ?? (input.staged ? "--staged" : "");
    case "git_log":
      return input.file ?? "";
    case "file_info":
      return input.path;
    default:
      return truncate(JSON.stringify(input), 80);
  }
}


/* -------------------------------------------------------------------------- */
/*  Message grouping                                                           */
/*                                                                             */
/*  Groups sequential timeline entries into "conversation turns":              */
/*  - A user message starts a new group                                        */
/*  - Agent text + tool calls following a user message belong to that group     */
/*  - Orphaned agent/tool entries (no preceding user msg) get their own group   */
/* -------------------------------------------------------------------------- */

interface MessageGroup {
  id: number;
  userText: string | null;
  userImages?: string[];
  responses: TimelineEntry[];
}

function groupTimeline(entries: TimelineEntry[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let current: MessageGroup | null = null;

  for (const entry of entries) {
    if (entry.kind === "user") {
      // Start a new group for each user message
      current = {
        id: groups.length,
        userText: entry.text,
        userImages: entry.images,
        responses: [],
      };
      groups.push(current);
    } else {
      // Attach agent text / tool calls to current group, or create orphan group
      if (!current) {
        current = { id: groups.length, userText: null, responses: [] };
        groups.push(current);
      }
      current.responses.push(entry);
    }
  }

  return groups;
}

/* -------------------------------------------------------------------------- */
/*  Tool entry                                                                 */
/* -------------------------------------------------------------------------- */

function ToolEntry({ entry }: { entry: TimelineEntry & { kind: "tool" } }) {
  const [expanded, setExpanded] = useState(false);
  const inputStr = formatToolInput(entry.name, entry.input);
  const hasOutput = !!entry.output;
  const lineCount = entry.output?.split("\n").length ?? 0;

  const statusIndicator =
    entry.status === "running" ? (
      <span className="tool-status-indicator running">
        <span className="spinner small" />
      </span>
    ) : entry.status === "success" ? (
      <span className="tool-status-indicator success">{"\u2713"}</span>
    ) : (
      <span className="tool-status-indicator error">{"\u2717"}</span>
    );

  return (
    <div className={`tool-entry ${expanded ? "tool-entry-expanded" : ""}`}>
      <button
        className="tool-header"
        onClick={() => hasOutput && setExpanded(!expanded)}
        aria-expanded={hasOutput ? expanded : undefined}
        aria-label={`Tool: ${entry.name}${inputStr ? ` - ${inputStr}` : ""}`}
      >
        {statusIndicator}
        <span className="tool-name">{entry.name}</span>
        {inputStr && <span className="tool-input">{inputStr}</span>}
        {hasOutput && (
          <span className="tool-expand-icon" aria-hidden="true">
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="currentColor"
              style={{
                transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
                transition: "transform 0.15s ease",
              }}
            >
              <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        )}
      </button>

      {expanded && entry.output && (
        <div className="tool-output-wrapper">
          <div className="tool-output-header">
            <span className="dim">Output</span>
            {lineCount > 30 && (
              <span className="dim">{lineCount} lines (showing first 30)</span>
            )}
          </div>
          <pre className="tool-output">{truncateLines(entry.output, 30)}</pre>
          {lineCount > 30 && (
            <div className="tool-output-fade" aria-hidden="true" />
          )}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Tool group (consecutive tool calls collapsed together)                     */
/* -------------------------------------------------------------------------- */

function ToolGroup({ tools }: { tools: (TimelineEntry & { kind: "tool" })[] }) {
  const [collapsed, setCollapsed] = useState(false);
  const completed = tools.filter((t) => t.status === "success").length;
  const running = tools.filter((t) => t.status === "running").length;
  const errored = tools.filter((t) => t.status === "error").length;

  // Only show group collapse controls when there are 3+ tool calls
  if (tools.length < 3) {
    return (
      <div className="tool-group">
        {tools.map((t) => (
          <ToolEntry key={t.id} entry={t} />
        ))}
      </div>
    );
  }

  return (
    <div className="tool-group">
      <button
        className="tool-group-toggle"
        onClick={() => setCollapsed(!collapsed)}
        aria-label={collapsed ? "Expand tool calls" : "Collapse tool calls"}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="currentColor"
          style={{
            transform: collapsed ? "rotate(0deg)" : "rotate(90deg)",
            transition: "transform 0.15s ease",
          }}
        >
          <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>{tools.length} tool calls</span>
        <span className="tool-group-stats">
          {completed > 0 && (
            <span className="tool-status-success">{completed} done</span>
          )}
          {running > 0 && (
            <span className="tool-status-running">{running} running</span>
          )}
          {errored > 0 && (
            <span className="tool-status-error">{errored} failed</span>
          )}
        </span>
      </button>

      {!collapsed &&
        tools.map((t) => <ToolEntry key={t.id} entry={t} />)}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Agent response block                                                       */
/*  Renders agent text as markdown and groups consecutive tool calls            */
/* -------------------------------------------------------------------------- */

function AgentResponseBlock({ responses }: { responses: TimelineEntry[] }) {
  // Segment responses into chunks: text blocks and tool groups
  const result: Array<
    | { type: "text"; text: string }
    | { type: "tools"; tools: (TimelineEntry & { kind: "tool" })[] }
  > = [];

  for (const entry of responses) {
    if (entry.kind === "agent_text") {
      result.push({ type: "text", text: entry.text });
    } else if (entry.kind === "tool") {
      const last = result[result.length - 1];
      if (last && last.type === "tools") {
        last.tools.push(entry);
      } else {
        result.push({ type: "tools", tools: [entry] });
      }
    }
  }

  return (
    <div className="agent-response">
      {result.map((seg, i) => {
        if (seg.type === "text") {
          return <Markdown key={i} content={seg.text} />;
        }
        return <ToolGroup key={i} tools={seg.tools} />;
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Conversation group                                                         */
/*  One user message + its agent response (text + tools)                       */
/* -------------------------------------------------------------------------- */

function ConversationGroup({ group }: { group: MessageGroup }) {
  return (
    <div className="conversation-group">
      {group.userText !== null && (
        <div className="user-message">
          <div className="user-avatar" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm5 6a5 5 0 0 0-10 0h10z" />
            </svg>
          </div>
          <div className="user-message-content">
            <span className="user-label">You</span>
            <div className="user-text">{group.userText}</div>
            {group.userImages && group.userImages.length > 0 && (
              <div className="user-images">
                {group.userImages.map((src, i) => (
                  <img
                    key={i}
                    src={src}
                    alt={`Attached image ${i + 1}`}
                    className="user-image"
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {group.responses.length > 0 && (
        <div className="agent-message">
          <div className="agent-avatar" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1a2.5 2.5 0 0 0-2.5 2.5v1A2.5 2.5 0 0 0 8 7a2.5 2.5 0 0 0 2.5-2.5v-1A2.5 2.5 0 0 0 8 1zM4 8.5A1.5 1.5 0 0 0 2.5 10v1.5c0 .69.56 1.25 1.25 1.25h.75v1.75a.5.5 0 0 0 1 0v-1.75h1v1.75a.5.5 0 0 0 1 0v-1.75h1v1.75a.5.5 0 0 0 1 0v-1.75h.75c.69 0 1.25-.56 1.25-1.25V10A1.5 1.5 0 0 0 12 8.5H4z" />
            </svg>
          </div>
          <div className="agent-message-content">
            <span className="agent-label">Agent</span>
            <AgentResponseBlock responses={group.responses} />
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Streaming indicator                                                        */
/* -------------------------------------------------------------------------- */

function StreamingBlock({ text }: { text: string }) {
  return (
    <div className="agent-message streaming-message">
      <div className="agent-avatar" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1a2.5 2.5 0 0 0-2.5 2.5v1A2.5 2.5 0 0 0 8 7a2.5 2.5 0 0 0 2.5-2.5v-1A2.5 2.5 0 0 0 8 1zM4 8.5A1.5 1.5 0 0 0 2.5 10v1.5c0 .69.56 1.25 1.25 1.25h.75v1.75a.5.5 0 0 0 1 0v-1.75h1v1.75a.5.5 0 0 0 1 0v-1.75h1v1.75a.5.5 0 0 0 1 0v-1.75h.75c.69 0 1.25-.56 1.25-1.25V10A1.5 1.5 0 0 0 12 8.5H4z" />
        </svg>
      </div>
      <div className="agent-message-content">
        <span className="agent-label">Agent</span>
        <div className="streaming-text">
          <Markdown content={text} />
          <span className="cursor" aria-label="Streaming">|</span>
        </div>
      </div>
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div className="agent-message thinking-message">
      <div className="agent-avatar" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1a2.5 2.5 0 0 0-2.5 2.5v1A2.5 2.5 0 0 0 8 7a2.5 2.5 0 0 0 2.5-2.5v-1A2.5 2.5 0 0 0 8 1zM4 8.5A1.5 1.5 0 0 0 2.5 10v1.5c0 .69.56 1.25 1.25 1.25h.75v1.75a.5.5 0 0 0 1 0v-1.75h1v1.75a.5.5 0 0 0 1 0v-1.75h1v1.75a.5.5 0 0 0 1 0v-1.75h.75c.69 0 1.25-.56 1.25-1.25V10A1.5 1.5 0 0 0 12 8.5H4z" />
        </svg>
      </div>
      <div className="agent-message-content">
        <span className="agent-label">Agent</span>
        <div className="thinking-dots">
          <span className="dot" />
          <span className="dot" />
          <span className="dot" />
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Timeline                                                                   */
/* -------------------------------------------------------------------------- */

export function Timeline({
  entries,
  streamingText,
  busy,
}: {
  entries: TimelineEntry[];
  streamingText: string;
  busy: boolean;
}) {
  const groups = useMemo(() => groupTimeline(entries), [entries]);

  return (
    <div className="timeline" role="log" aria-label="Conversation timeline">
      {groups.map((group) => (
        <ConversationGroup key={group.id} group={group} />
      ))}

      {busy && streamingText && <StreamingBlock text={streamingText} />}
      {busy && !streamingText && <ThinkingIndicator />}
    </div>
  );
}
