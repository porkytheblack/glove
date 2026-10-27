"use client";

import { useEffect, useRef, useState } from "react";
import { TERMINAL_RUN_EVENTS, type DisplayMessage, type DisplayTool, type LiveEvent } from "../shared";

export type LiveStatus = "idle" | "running" | "completed" | "failed" | "cancelled";

export interface LiveRun {
  /** The reply so far, in the same shape as the transcript: tools above the text they lead to. */
  readonly messages: ReadonlyArray<DisplayMessage>;
  readonly status: LiveStatus;
}

export interface LiveRunOptions {
  /** The app's SSE route for a run. Defaults to /api/runs/<id>/live. */
  readonly url?: (runId: string) => string;
  /** An approval was requested on this run: fetch it and show the card. */
  readonly onApproval?: (approvalId: string, toolName: string) => void;
  /** The run ended: refetch the transcript. */
  readonly onEnd?: (status: Exclude<LiveStatus, "idle" | "running">) => void;
}

function apply(messages: DisplayMessage[], event: LiveEvent, runId: string): DisplayMessage[] {
  const last = messages.at(-1);
  const id = `live-${runId}-${event.seq}`;
  switch (event.type) {
    case "agent.text_delta":
      if (last) return [...messages.slice(0, -1), { ...last, text: last.text + event.text }];
      return [{ id, sender: "agent", text: event.text }];
    case "agent.tool_use": {
      const tool: DisplayTool = { name: event.name, status: "running", ...(event.label ? { label: event.label } : {}), ...(event.chip ? { chip: true } : {}) };
      // A tool leads to the text after it, so text already shown closes that message.
      if (last && !last.text) return [...messages.slice(0, -1), { ...last, tools: [...(last.tools ?? []), tool] }];
      return [...messages, { id, sender: "agent", text: "", tools: [tool] }];
    }
    case "agent.tool_use_result": {
      for (let index = messages.length - 1; index >= 0; index--) {
        const tools = messages[index]!.tools ?? [];
        let position = tools.length - 1;
        while (position >= 0 && !(tools[position]!.name === event.name && tools[position]!.status === "running")) position--;
        if (position < 0) continue;
        const next = [...messages];
        next[index] = { ...messages[index]!, tools: tools.map((tool, i) => i === position ? { ...tool, status: event.status } : tool) };
        return next;
      }
      // A result with no call seen (a tool the model didn't stream): show it done.
      return [...messages, { id, sender: "agent", text: "", tools: [{ name: event.name, status: event.status }] }];
    }
    default:
      return messages;
  }
}

/**
 * Follow a run live over the app's SSE route: streamed text, tool activity,
 * approvals and the end. Closes on the run's end, and resumes where it left
 * off if the connection drops (EventSource sends Last-Event-ID).
 */
export function useLiveRun(runId: string | null | undefined, options: LiveRunOptions = {}): LiveRun {
  const [state, setState] = useState<LiveRun>({ messages: [], status: "idle" });
  const callbacks = useRef(options);
  callbacks.current = options;

  useEffect(() => {
    if (!runId) {
      setState({ messages: [], status: "idle" });
      return;
    }
    setState({ messages: [], status: "running" });
    const source = new EventSource((callbacks.current.url ?? ((id: string) => `/api/runs/${encodeURIComponent(id)}/live`))(runId));
    let ended = false;
    source.onmessage = (message) => {
      let event: LiveEvent;
      try {
        event = JSON.parse(message.data) as LiveEvent;
      } catch {
        return;
      }
      if (event.type === "agent.foundry.approval.requested") callbacks.current.onApproval?.(event.approvalId, event.toolName);
      if (TERMINAL_RUN_EVENTS.includes(event.type)) {
        ended = true;
        source.close();
        const status = event.type.slice(4) as "completed" | "failed" | "cancelled";
        setState((current) => ({ ...current, status }));
        callbacks.current.onEnd?.(status);
        return;
      }
      setState((current) => ({ ...current, messages: apply([...current.messages], event, runId) }));
    };
    source.onerror = () => {
      // The browser reconnects by itself; a 404 or 401 closes the source for good.
      if (source.readyState === EventSource.CLOSED && !ended) {
        ended = true;
        setState((current) => ({ ...current, status: "failed" }));
        callbacks.current.onEnd?.("failed");
      }
    };
    return () => {
      ended = true;
      source.close();
    };
  }, [runId]);

  return state;
}
