"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import type { DisplayMessage } from "../shared";
import { Message, Turn, type Author } from "./Message";

export interface ThreadProps {
  readonly messages: ReadonlyArray<DisplayMessage>;
  /** Messages still streaming in, from useLiveRun. Shown after the rest. */
  readonly live?: ReadonlyArray<DisplayMessage>;
  /** In a group, who wrote each agent message. Consecutive messages by one author form one turn. */
  readonly authorOf?: (message: DisplayMessage) => Author | undefined;
  readonly renderText?: (text: string) => ReactNode;
  /** Shown when there are no messages. */
  readonly empty?: ReactNode;
  /** After the messages: approval cards and the like. */
  readonly children?: ReactNode;
  readonly style?: CSSProperties;
}

type Block =
  | { readonly kind: "one"; readonly message: DisplayMessage }
  | { readonly kind: "turn"; readonly author?: Author; readonly messages: DisplayMessage[] };

function blocks(messages: ReadonlyArray<DisplayMessage>, authorOf?: ThreadProps["authorOf"]): Block[] {
  const out: Block[] = [];
  for (const message of messages) {
    if (message.sender !== "agent") {
      out.push({ kind: "one", message });
      continue;
    }
    const author = authorOf?.(message);
    const last = out.at(-1);
    if (last?.kind === "turn" && last.author?.name === author?.name) last.messages.push(message);
    else out.push({ kind: "turn", ...(author ? { author } : {}), messages: [message] });
  }
  return out;
}

/** A conversation: messages, then whatever is streaming, then the children. Keeps the newest in view. */
export function Thread({ messages, live = [], authorOf, renderText, empty, children, style }: ThreadProps) {
  const end = useRef<HTMLDivElement>(null);
  const all = [...messages, ...live];
  const size = all.length + all.reduce((total, message) => total + message.text.length, 0);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [size]);
  return (
    <div role="log" aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 18, ...style }}>
      {all.length === 0 ? empty : null}
      {blocks(all, authorOf).map((block) => block.kind === "one"
        ? <Message key={block.message.id} message={block.message} {...(renderText ? { renderText } : {})} />
        : <Turn key={block.messages[0]!.id} messages={block.messages} {...(block.author ? { author: block.author } : {})} {...(renderText ? { renderText } : {})} />)}
      {children}
      <div ref={end} />
    </div>
  );
}
