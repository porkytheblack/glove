import type { GloveFoldArgs } from "glove-core";
import { z } from "zod";
import type { AgentAssemblyContext } from "glove-foundry";
import { blockedBecause, strictlyBlocked } from "../../lib/guard.js";
import { record } from "../../lib/ledger.js";

/**
 * What the partner can do in the world. Each one waits for the person's
 * approval: Foundry records the exact input and holds the run until they
 * answer. Everything that leaves goes through the guard first. Trading and
 * moving money between accounts are off limits, so there is no tool for them.
 */

const blocked = (reason: string) => ({
  status: "error" as const,
  data: null,
  message: `Blocked: ${reason}. Tell the person you will not send it, and why.`,
});

export const actionTools = (ctx: Pick<AgentAssemblyContext, "request" | "messageText">): GloveFoldArgs<any>[] => [
  {
    name: "send_message",
    description: "Send a text or email to someone on the person's behalf.",
    inputSchema: z.object({ to: z.string(), via: z.enum(["text", "email"]), text: z.string().min(1) }),
    // A message the guard will refuse is not worth asking about.
    requiresPermission: ({ text }: { readonly text: string }) => !strictlyBlocked(text),
    async do(message: { readonly to: string; readonly via: string; readonly text: string }) {
      const reason = await blockedBecause(message.text, ctx.request.source?.kind === "direct" ? ctx.messageText : undefined);
      if (reason) return blocked(reason);
      await record({ kind: "message", ...message });
      return { status: "success" as const, data: { sent: true, to: message.to } };
    },
  },
  {
    name: "pay_invoice",
    description: "Pay an invoice from the person's account.",
    inputSchema: z.object({ invoiceId: z.string(), payee: z.string(), amount: z.number().positive(), currency: z.string().default("USD") }),
    requiresPermission: true,
    async do(payment: { readonly invoiceId: string; readonly payee: string; readonly amount: number; readonly currency: string }) {
      await record({ kind: "payment", ...payment });
      return { status: "success" as const, data: { paid: true, ...payment } };
    },
  },
  {
    name: "sign_document",
    description: "Sign a document that is waiting for the person's signature.",
    inputSchema: z.object({ documentId: z.string(), title: z.string() }),
    requiresPermission: true,
    async do(document: { readonly documentId: string; readonly title: string }) {
      await record({ kind: "signature", ...document });
      return { status: "success" as const, data: { signed: true, ...document } };
    },
  },
  {
    name: "delete_file",
    description: "Delete a file from the person's drive.",
    inputSchema: z.object({ path: z.string() }),
    requiresPermission: true,
    async do({ path }: { readonly path: string }) {
      await record({ kind: "deletion", path });
      return { status: "success" as const, data: { deleted: path } };
    },
  },
];
