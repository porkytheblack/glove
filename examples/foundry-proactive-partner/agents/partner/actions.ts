import type { GloveFoldArgs } from "glove-core";
import { z } from "zod";
import { record } from "../../lib/ledger.js";

/**
 * What the partner can do outside its apps. Each one waits for the person's
 * approval: Foundry records the exact input and holds the run until they
 * answer. Email goes out through the Gmail app (send.ts). Trading and moving
 * money between accounts are off limits, so there is no tool for them.
 *
 * These three are stand-ins: they write the ledger and change nothing. Each
 * `do` is where your payment, e-signature or storage provider's call goes;
 * better still, make the provider a Foundry app with an outbound transmission,
 * as Gmail's send is.
 */
export const actionTools = (): GloveFoldArgs<any>[] => [
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
