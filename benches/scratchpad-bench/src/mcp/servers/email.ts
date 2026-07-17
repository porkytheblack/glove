import { z } from "zod";
import { single } from "../spec";
import type { ServerSpec } from "../spec";
import type { World } from "../seed";

const lc = (v: unknown) => String(v ?? "").toLowerCase();

export function emailServer(world: World): ServerSpec {
  const cols = [
    { name: "id", type: "text" },
    { name: "from_addr", type: "text" },
    { name: "to_addr", type: "text" },
    { name: "subject", type: "text" },
    { name: "snippet", type: "text" },
    { name: "date", type: "timestamptz" },
    { name: "unread", type: "boolean" },
    { name: "labels", type: "text" },
  ];
  const shape = (m: (typeof world.emails)[number]) => ({
    id: m.id, from_addr: m.from, to_addr: m.to, subject: m.subject,
    snippet: m.snippet, date: m.date, unread: m.unread, labels: m.labels,
  });

  return {
    namespace: "email",
    title: "Email (Gmail-style)",
    tools: [
      {
        name: "list_messages",
        description: "List inbox messages, optionally only unread, or filtered by a label.",
        readOnly: true,
        input: { unread: z.boolean().optional(), label: z.string().optional() },
        handler: (a) =>
          world.emails
            .filter((m) => (a.unread === undefined || m.unread === a.unread) && (!a.label || lc(m.labels).includes(lc(a.label))))
            .map(shape),
      },
      {
        name: "search_messages",
        description: "Full-text search over subject + snippet.",
        readOnly: true,
        input: { query: z.string() },
        handler: (a) =>
          world.emails.filter((m) => lc(m.subject + " " + m.snippet).includes(lc(a.query))).map(shape),
      },
      {
        name: "send_email",
        description: "Send an email.",
        readOnly: false,
        input: { to: z.string(), subject: z.string(), body: z.string() },
        handler: (a) => {
          const id = `msg-out-${world.outbox.filter((o) => o.kind === "email.send").length + 1}`;
          world.outbox.push({ kind: "email.send", at: new Date(0).toISOString(), payload: a });
          return { id, to: a.to, subject: a.subject, status: "sent" };
        },
      },
    ],
    entities: [
      {
        table: "emails",
        description: "Inbox messages. INSERT (to_addr, subject, body) sends a new email.",
        volatility: "stable",
        columns: [...cols, { name: "body", type: "text" }],
        select: {
          tool: "list_messages",
          args: (b) => ({
            ...(single(b, "unread") && { unread: b.one("unread") }),
            ...(single(b, "labels") && { label: b.one("labels") }),
          }),
        },
        insert: {
          tool: "send_email",
          args: (r) => ({ to: r.to_addr, subject: r.subject, body: r.body ?? r.snippet ?? "" }),
        },
      },
    ],
  };
}
