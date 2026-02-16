import { useEffect, useRef, useState } from "react";
import { useAgentPool } from "./hooks/useAgentPool";
import { Timeline } from "./components/Timeline";
import { TaskList } from "./components/TaskList";
import { InputBar } from "./components/InputBar";
import { SlotRenderer } from "./components/PermissionPrompt";
import { StatusBar } from "./components/StatusBar";
import { SessionSidebar } from "./components/SessionSidebar";
import { DirectoryPicker } from "./components/DirectoryPicker";
import { ModelPicker } from "./components/ModelPicker";
import { ModelSwitcher } from "./components/ModelSwitcher";

const SERVER_WS = "ws://localhost:3000";
const SERVER_HTTP = "http://localhost:3000";

/* -------------------------------------------------------------------------- */
/*  Welcome screen                                                             */
/* -------------------------------------------------------------------------- */

function WelcomeScreen() {
  return (
    <div className="welcome">
      <div className="welcome-icon" aria-hidden="true">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M24 4a10 10 0 0 0-10 10v4a10 10 0 0 0 20 0v-4a10 10 0 0 0-10-10z" opacity="0.3" fill="var(--accent)" />
          <rect x="10" y="28" width="28" height="12" rx="4" opacity="0.3" fill="var(--accent)" />
          <circle cx="18" cy="34" r="1.5" fill="var(--accent)" />
          <circle cx="24" cy="34" r="1.5" fill="var(--accent)" />
          <circle cx="30" cy="34" r="1.5" fill="var(--accent)" />
          <path d="M16 42v4" stroke="var(--accent)" strokeWidth="2" />
          <path d="M20 42v4" stroke="var(--accent)" strokeWidth="2" />
          <path d="M28 42v4" stroke="var(--accent)" strokeWidth="2" />
          <path d="M32 42v4" stroke="var(--accent)" strokeWidth="2" />
        </svg>
      </div>
      <h2 className="welcome-title">What can I help you build?</h2>
      <p className="welcome-subtitle">
        I can read, write, and edit code, run terminal commands, search your codebase, and more.
      </p>
      <div className="welcome-hints">
        <div className="welcome-hint">
          <span className="welcome-hint-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z" />
              <path d="M6 6h4M6 9h2" />
            </svg>
          </span>
          <span>Describe a feature to implement</span>
        </div>
        <div className="welcome-hint">
          <span className="welcome-hint-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="6" cy="6" r="4" />
              <line x1="14" y1="14" x2="9" y2="9" />
            </svg>
          </span>
          <span>Ask about your code or project structure</span>
        </div>
        <div className="welcome-hint">
          <span className="welcome-hint-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 8a4 4 0 1 0-8 0" />
              <path d="M8 12V8" />
              <circle cx="8" cy="14" r="1" />
            </svg>
          </span>
          <span>Debug an issue or fix a bug</span>
        </div>
        <div className="welcome-hint">
          <span className="welcome-hint-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="12" height="12" rx="2" />
              <path d="M5 8h6M8 5v6" />
            </svg>
          </span>
          <span>Paste a screenshot to discuss UI changes</span>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  App                                                                        */
/* -------------------------------------------------------------------------- */

export function App() {
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [newSessionCwd, setNewSessionCwd] = useState<string | null>(null);

  // Model config for new sessions (used only when creating a new session)
  const [provider, setProvider] = useState<string | undefined>(undefined);
  const [model, setModel] = useState<string | undefined>(undefined);
  const [planning, setPlanning] = useState(true);
  const [tasking, setTasking] = useState(true);
  const [autoAccept, setAutoAccept] = useState(false);

  // The pool key determines which connection is shown.
  // - selectedSession (a real UUID): show that existing session
  // - "_new_session": a new session is being created (CWD picked, no ID yet)
  // - null: no session active (show the new-session form)
  const NEW_SESSION_KEY = "_new_session";

  const poolKey =
    selectedSession !== null
      ? selectedSession
      : newSessionCwd !== null
        ? NEW_SESSION_KEY
        : null;

  // Use the pool hook instead of the single-connection hook.
  // The pool keeps background sessions' WebSocket connections alive.
  const {
    connected,
    busy,
    sessionId,
    sessionName,
    workingDir,
    modelName,
    features,
    timeline,
    streamingText,
    tasks,
    slots,
    stats,
    sessionStatuses,
    resolvedActiveKey,
    sendRequest,
    resolveSlot,
    abort,
    changeModel,
  } = useAgentPool(SERVER_WS, poolKey, {
    // For new sessions, don't pass a sessionId so the server creates one
    sessionId: selectedSession !== null ? selectedSession : undefined,
    cwd: newSessionCwd ?? undefined,
    provider,
    model,
    planning,
    tasking,
    autoAccept,
  });

  // Alias for readability in the template
  const hasSession = poolKey !== null;

  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new content
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [timeline.length, streamingText, tasks, slots]);

  // Escape key to abort
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && busy) {
        abort();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [busy, abort]);

  // When a new session connects and the server assigns a real ID,
  // update selectedSession so the pool key matches the real ID.
  // Also handles the remapping from temp key ("_new_session") to real ID.
  // Skip when poolKey is null (user is on the new-session form).
  useEffect(() => {
    if (!poolKey) return;

    if (sessionId && !selectedSession) {
      setSelectedSession(sessionId);
    }
    // If the pool remapped a temp key to a real ID, sync our state
    if (
      resolvedActiveKey &&
      resolvedActiveKey !== poolKey &&
      !resolvedActiveKey.startsWith("_new_")
    ) {
      setSelectedSession(resolvedActiveKey);
    }
  }, [sessionId, selectedSession, resolvedActiveKey, poolKey]);

  const handleNewSession = () => {
    setSelectedSession(null);
    setNewSessionCwd(null);
  };

  const showCwdForm = selectedSession === null && newSessionCwd === null;
  const showWelcome = hasSession && timeline.length === 0 && !busy;

  return (
    <div className="app-layout">
      <SessionSidebar
        serverHttpUrl={SERVER_HTTP}
        activeSessionId={selectedSession ?? sessionId}
        sessionStatuses={sessionStatuses}
        onSelect={(id) => {
          setSelectedSession(id);
          setNewSessionCwd(null);
        }}
        onNewSession={handleNewSession}
      />

      <div className="chat-panel">
        <header className="header">
          {workingDir && (
            <span className="header-cwd" title={workingDir}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -1, marginRight: 4 }}>
                <path d="M1 4l4-2.5L9 4l2.5 1.5v4L9 8 5 10.5 1 8V4z" />
              </svg>
              {workingDir}
            </span>
          )}
          {sessionName && (
            <span className="header-name">{sessionName}</span>
          )}
          {/* Model switcher replaces the static model badge.
              Clicking it opens a popover to change provider/model mid-session. */}
          {hasSession && (
            <ModelSwitcher
              serverHttpUrl={SERVER_HTTP}
              currentModel={modelName}
              busy={busy}
              onChangeModel={changeModel}
            />
          )}
        </header>

        <main className="main">
          {showCwdForm ? (
            <div className="new-session-form">
              <h2>New session</h2>
              <p className="dim">Choose a working directory for this session</p>
              <DirectoryPicker
                serverHttpUrl={SERVER_HTTP}
                onSelect={(path) => setNewSessionCwd(path)}
              />
              <ModelPicker
                serverHttpUrl={SERVER_HTTP}
                provider={provider}
                model={model}
                planning={planning}
                tasking={tasking}
                autoAccept={autoAccept}
                onProviderChange={setProvider}
                onModelChange={setModel}
                onPlanningChange={setPlanning}
                onTaskingChange={setTasking}
                onAutoAcceptChange={setAutoAccept}
              />
            </div>
          ) : (
            <>
              {showWelcome && <WelcomeScreen />}

              <Timeline
                entries={timeline}
                streamingText={streamingText}
                busy={busy}
              />
              {features.tasking && <TaskList tasks={tasks} />}

              <div ref={bottomRef} />
            </>
          )}
        </main>

        {/* Slot modals render as overlays on top of everything */}
        {slots.map((slot) => (
          <SlotRenderer
            key={slot.id}
            slot={slot}
            onResolve={(value) => resolveSlot(slot.id, value)}
          />
        ))}

        {hasSession && (
          <footer className="footer">
            <InputBar
              onSubmit={sendRequest}
              onAbort={abort}
              busy={busy}
              connected={connected}
            />
            <StatusBar connected={connected} stats={stats} />
          </footer>
        )}
      </div>
    </div>
  );
}
