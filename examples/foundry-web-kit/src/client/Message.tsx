import { Fragment, type CSSProperties, type ReactNode } from "react";
import type { DisplayMessage, DisplayTool } from "../shared";
import { token as t } from "./theme";

export interface Author {
  readonly name: string;
  /** Two letters for the avatar. */
  readonly initials: string;
}

export interface MessageProps {
  readonly message: DisplayMessage;
  /** In a group, who wrote an agent's message: shown as an avatar and a name. */
  readonly author?: Author;
  /** How to show text, e.g. to colour @mentions. Plain text by default. */
  readonly renderText?: (text: string) => ReactNode;
}

const bubble: CSSProperties = { padding: "12px 16px", fontSize: 15, lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" };

export const avatarStyle = (size: number): CSSProperties => ({
  width: size,
  height: size,
  flex: "none",
  borderRadius: size >= 32 ? 9 : 8,
  background: t("line"),
  color: t("text"),
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: size >= 32 ? 13 : 12,
});

function toolLine(tool: DisplayTool): string {
  const text = tool.label ?? `Used ${tool.name}`;
  if (tool.status === "running") return `${text}…`;
  return tool.status === "error" ? `${text} · didn't finish` : text;
}

/** A pill under a reply, for a handoff and the like. */
export function Chip({ children }: { readonly children: ReactNode }) {
  return (
    <span style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 999, border: `1px solid ${t("lineStrong")}`, fontSize: 13, color: t("muted") }}>
      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 999, background: t("accent") }} />
      {children}
    </span>
  );
}

/** One message: the person's on the right, an agent's on the left with its tools above. */
export function Message({ message, author, renderText = (text) => text }: MessageProps) {
  if (message.sender === "person") {
    return (
      <div data-sender="person" style={{ ...bubble, alignSelf: "flex-end", maxWidth: "80%", borderRadius: "14px 14px 4px 14px", background: t("mine"), color: t("text") }}>
        {renderText(message.text)}
      </div>
    );
  }
  if (message.sender === "event") {
    return (
      <span data-sender="event" style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 8, fontFamily: t("mono"), fontSize: 12, color: t("muted") }}>
        <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 999, background: t("muted") }} />
        {message.text}
      </span>
    );
  }
  return <Turn messages={[message]} {...(author ? { author } : {})} renderText={renderText} />;
}

/**
 * Consecutive agent messages as one turn: each reply with the tool lines
 * above it and its chips (handoffs) below.
 */
export function Turn({ messages, author, renderText = (text) => text }: { readonly messages: ReadonlyArray<DisplayMessage> } & Omit<MessageProps, "message">) {
  const body = (
    <div style={{ display: "flex", flexDirection: "column", gap: author ? 6 : 8, minWidth: 0 }}>
      {author ? <span style={{ fontSize: 13, color: t("muted") }}>{author.name}</span> : null}
      {messages.map((message) => (
        <Fragment key={message.id}>
          {(message.tools ?? []).filter((tool) => !tool.chip).map((tool, index) => (
            <span key={`${tool.name}-${index}`} data-tool={tool.name} data-status={tool.status} style={{ fontFamily: t("mono"), fontSize: 12, color: t("muted") }}>
              {toolLine(tool)}
            </span>
          ))}
          {message.text ? (
            <div data-sender="agent" style={{ ...bubble, borderRadius: author ? "4px 14px 14px 14px" : "14px 14px 14px 4px", background: t("raised"), border: `1px solid ${t("line")}`, color: t("text") }}>
              {renderText(message.text)}
            </div>
          ) : null}
          {(message.tools ?? []).filter((tool) => tool.chip).map((tool, index) => <Chip key={`${tool.name}-chip-${index}`}>{tool.label ?? tool.name}</Chip>)}
        </Fragment>
      ))}
    </div>
  );
  if (!author) return <div style={{ display: "flex", flexDirection: "column", maxWidth: "86%" }}>{body}</div>;
  return (
    <div style={{ display: "flex", gap: 12, maxWidth: "86%" }}>
      <span aria-hidden="true" style={avatarStyle(32)}>{author.initials}</span>
      {body}
    </div>
  );
}
