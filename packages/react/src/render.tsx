"use client";

import React, {
  useMemo,
  useCallback,
  useRef,
  Fragment,
  type ReactNode,
} from "react";
import type {
  RenderStrategy,
  EnhancedSlot,
  TimelineEntry,
  MessageRenderProps,
  ToolStatusRenderProps,
  StreamingRenderProps,
  InputRenderProps,
  SlotContainerRenderProps,
  GloveHandle,
} from "./types";

// ─── Render Props ─────────────────────────────────────────────────

export interface RenderProps {
  /** The return value of useGlove() */
  glove: GloveHandle;

  /** Where slots appear relative to conversation */
  strategy?: RenderStrategy;

  /** Render a user or agent_text entry */
  renderMessage?: (props: MessageRenderProps) => ReactNode;

  /** Render a tool status pill (optional — hidden by default) */
  renderToolStatus?: (props: ToolStatusRenderProps) => ReactNode;

  /** Render the streaming text buffer */
  renderStreaming?: (props: StreamingRenderProps) => ReactNode;

  /** Render the input area */
  renderInput?: (props: InputRenderProps) => ReactNode;

  /** Override slot container rendering for slots-before / slots-after.
   *  Default: renders slots in a vertical stack. */
  renderSlotContainer?: (props: SlotContainerRenderProps) => ReactNode;

  /** Wrapper element for the entire output. Default: div */
  as?: keyof React.JSX.IntrinsicElements;

  /** className on the wrapper */
  className?: string;

  /** style on the wrapper */
  style?: React.CSSProperties;
}

// ─── Slot Visibility Engine ───────────────────────────────────────

function useVisibleSlots(slots: EnhancedSlot[]): EnhancedSlot[] {
  return useMemo(() => {
    const latestByTool = new Map<string, number>();

    for (const slot of slots) {
      const existing = latestByTool.get(slot.toolName);
      if (existing === undefined || slot.createdAt > existing) {
        latestByTool.set(slot.toolName, slot.createdAt);
      }
    }

    return slots.filter((slot) => {
      switch (slot.displayStrategy) {
        case "stay":
          return true;
        case "hide-on-complete":
          return slot.status === "pending";
        case "hide-on-new":
          return slot.createdAt === latestByTool.get(slot.toolName);
        default:
          return true;
      }
    });
  }, [slots]);
}

// ─── Interleaving Engine ──────────────────────────────────────────

type RenderItem =
  | { type: "entry"; entry: TimelineEntry; index: number }
  | { type: "slot"; slot: EnhancedSlot }
  | { type: "streaming"; text: string };

function useInterleavedItems(
  timeline: TimelineEntry[],
  visibleSlots: EnhancedSlot[],
  streamingText: string,
  strategy: RenderStrategy,
): RenderItem[] {
  return useMemo(() => {
    const items: RenderItem[] = [];

    if (strategy === "slots-only") {
      for (const slot of visibleSlots) {
        items.push({ type: "slot", slot });
      }
      return items;
    }

    // Index slots by toolCallId for O(1) lookup during interleaving
    const slotsByToolCallId = new Map<string, EnhancedSlot[]>();
    for (const slot of visibleSlots) {
      const existing = slotsByToolCallId.get(slot.toolCallId) ?? [];
      existing.push(slot);
      slotsByToolCallId.set(slot.toolCallId, existing);
    }

    const placedSlotIds = new Set<string>();

    for (let i = 0; i < timeline.length; i++) {
      const entry = timeline[i];
      items.push({ type: "entry", entry, index: i });

      // In interleaved mode, insert matching slots after their tool call
      if (strategy === "interleaved" && entry.kind === "tool") {
        const matchingSlots = slotsByToolCallId.get(entry.id) ?? [];
        for (const slot of matchingSlots) {
          items.push({ type: "slot", slot });
          placedSlotIds.add(slot.id);
        }
      }
    }

    // Append streaming text if active
    if (streamingText) {
      items.push({ type: "streaming", text: streamingText });
    }

    // slots-after: append all visible slots at the end
    if (strategy === "slots-after") {
      for (const slot of visibleSlots) {
        items.push({ type: "slot", slot });
      }
    }

    // interleaved: catch orphaned slots (no matching tool entry yet)
    if (strategy === "interleaved") {
      for (const slot of visibleSlots) {
        if (!placedSlotIds.has(slot.id)) {
          items.push({ type: "slot", slot });
        }
      }
    }

    return items;
  }, [timeline, visibleSlots, streamingText, strategy]);
}

// ─── Default Renderers ────────────────────────────────────────────

function DefaultMessage({ entry }: MessageRenderProps): ReactNode {
  if (entry.kind === "user") {
    return <div data-glove-role="user">{entry.text}</div>;
  }
  return <div data-glove-role="agent">{entry.text}</div>;
}

function DefaultStreaming({ text }: StreamingRenderProps): ReactNode {
  return (
    <div data-glove-role="agent" data-glove-streaming="true">
      {text}
    </div>
  );
}

function DefaultToolStatus(_props: ToolStatusRenderProps): ReactNode {
  return null;
}

function DefaultInput({ send, busy }: InputRenderProps): ReactNode {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <form
      data-glove-role="input"
      onSubmit={(e) => {
        e.preventDefault();
        const val = ref.current?.value?.trim();
        if (!val || busy) return;
        send(val);
        if (ref.current) ref.current.value = "";
      }}
    >
      <input ref={ref} disabled={busy} placeholder="Type a message..." />
      <button type="submit" disabled={busy}>
        Send
      </button>
    </form>
  );
}

// ─── <Render> Component ───────────────────────────────────────────

export function Render({
  glove,
  strategy = "interleaved",
  renderMessage,
  renderToolStatus,
  renderStreaming,
  renderInput,
  renderSlotContainer,
  as: Tag = "div",
  className,
  style,
}: RenderProps): ReactNode {
  const {
    timeline,
    streamingText,
    busy,
    slots,
    sendMessage,
    abort,
    renderSlot,
    renderToolResult,
  } = glove;

  const visibleSlots = useVisibleSlots(slots);

  const items = useInterleavedItems(
    timeline,
    visibleSlots,
    streamingText,
    strategy,
  );

  const inputProps: InputRenderProps = useMemo(
    () => ({ send: sendMessage, busy, abort }),
    [sendMessage, busy, abort],
  );

  const Message = renderMessage ?? DefaultMessage;
  const ToolStatus = renderToolStatus ?? DefaultToolStatus;
  const Streaming = renderStreaming ?? DefaultStreaming;
  const Input = renderInput ?? DefaultInput;

  const toolHasSlot = useCallback(
    (toolId: string) => visibleSlots.some((s) => s.toolCallId === toolId),
    [visibleSlots],
  );

  const slotsBeforeBlock =
    strategy === "slots-before" && visibleSlots.length > 0 ? (
      renderSlotContainer ? (
        renderSlotContainer({ slots: visibleSlots, renderSlot })
      ) : (
        <div data-glove-role="slots">
          {visibleSlots.map((slot) => (
            <Fragment key={slot.id}>
              {renderSlot(slot)}
            </Fragment>
          ))}
        </div>
      )
    ) : null;

  return (
    <Tag className={className} style={style} data-glove-strategy={strategy}>
      {slotsBeforeBlock}

      {items.map((item) => {
        switch (item.type) {
          case "entry": {
            const entry = item.entry;

            if (entry.kind === "user" || entry.kind === "agent_text") {
              const isLast =
                item.index === timeline.length - 1 && !streamingText;
              return (
                <Fragment key={`entry-${item.index}`}>
                  {Message({ entry, index: item.index, isLast })}
                </Fragment>
              );
            }

            if (entry.kind === "tool") {
              const toolResult =
                entry.renderData !== undefined
                  ? renderToolResult(entry)
                  : null;
              return (
                <Fragment key={`tool-${entry.id}`}>
                  {ToolStatus({
                    entry,
                    index: item.index,
                    hasSlot: toolHasSlot(entry.id),
                  })}
                  {toolResult}
                </Fragment>
              );
            }

            return null;
          }

          case "slot":
            return (
              <Fragment key={`slot-${item.slot.id}`}>
                {renderSlot(item.slot)}
              </Fragment>
            );

          case "streaming":
            return (
              <Fragment key="streaming">
                {Streaming({ text: item.text })}
              </Fragment>
            );

          default:
            return null;
        }
      })}

      {Input(inputProps)}
    </Tag>
  );
}
