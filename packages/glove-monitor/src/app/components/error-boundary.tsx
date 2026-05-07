"use client"

import { Component, type ErrorInfo, type ReactNode } from "react"

interface ErrorBoundaryState {
  err: Error | null
}

/**
 * Top-level error boundary. Catches render-phase errors from any descendant
 * (in particular SSE callback handlers that throw, malformed event payloads
 * that crash the timeline, third-party-component bugs) and shows a recovery
 * shell instead of the bare React white screen. Without this, a single bad
 * event payload could blank the whole dashboard until refresh.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { err: null }

  static getDerivedStateFromError(err: Error): ErrorBoundaryState {
    return { err }
  }

  componentDidCatch(err: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error("[glove-monitor] dashboard error:", err, info.componentStack)
  }

  reset = (): void => {
    this.setState({ err: null })
  }

  render(): ReactNode {
    if (!this.state.err) return this.props.children
    return (
      <div style={{ padding: "3rem 1.5rem", maxWidth: 640, margin: "0 auto" }}>
        <h1 style={{ marginBottom: "0.5rem" }}>Something went wrong.</h1>
        <p className="muted" style={{ marginBottom: "1rem", fontSize: "0.875rem" }}>
          A render error crashed this part of the dashboard. The server is unaffected.
        </p>
        <pre
          className="json-viewer"
          style={{ marginBottom: "1rem", whiteSpace: "pre-wrap", maxHeight: 240 }}
        >
          {this.state.err.stack ?? this.state.err.message}
        </pre>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button type="button" className="btn btn--primary" onClick={this.reset}>Try again</button>
          <button type="button" className="btn" onClick={() => window.location.reload()}>Hard reload</button>
        </div>
      </div>
    )
  }
}
