import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { defineApp } from "glove-foundry";
import { z } from "zod";
import { record } from "../../../lib/ledger.js";

interface Draft { readonly to: string; readonly subject: string; readonly body: string }

/**
 * Email, for the bots that need it. Installed per bot: a bot without it has
 * no mail tools at all. your code: Gmail, or a Kuiper inbox with inboxTools.
 */
export default defineApp({
  description: "Read mail, draft emails, and send them once the owner approves",
  install: () => {
    const drafts = new Map<string, Draft>();
    return Effect.succeed({
      tools: [
        {
          name: "draft_email",
          description: "Draft an email. Nothing is sent.",
          inputSchema: z.object({ to: z.string().email(), subject: z.string(), body: z.string() }),
          async do(draft: Draft) {
            const draftId = `draft_${randomUUID().slice(0, 8)}`;
            drafts.set(draftId, draft);
            return { status: "success" as const, data: { draftId, ...draft } };
          },
        },
        {
          name: "send_email",
          description: "Send a draft. The owner approves every send first.",
          inputSchema: z.object({ draftId: z.string() }),
          // Foundry turns this into an approval with the exact input, and waits.
          requiresPermission: true,
          async do({ draftId }: { readonly draftId: string }) {
            const draft = drafts.get(draftId);
            if (!draft) return { status: "error" as const, data: null, message: `No draft ${draftId}.` };
            await record({ kind: "email", ...draft });
            return { status: "success" as const, data: { sent: true, to: draft.to } };
          },
        },
      ],
    });
  },
});
