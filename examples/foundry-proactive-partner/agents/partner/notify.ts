import type { GloveFoldArgs } from "glove-core";
import { z } from "zod";
import { strictlyBlocked } from "../../lib/guard.js";
import { record } from "../../lib/ledger.js";

/**
 * The only way the partner reaches the person's phone. It goes to the person
 * themselves, so only the strict tier of the guard applies. Without PUSH_URL it
 * writes to the ledger; with it, it posts to an ntfy-style endpoint
 * (POST the body, Title header), such as https://ntfy.sh/<your topic>.
 */
export const notifyTool: GloveFoldArgs<any> = {
  name: "notify_person",
  description: "Send the person a push notification. Use it only when something needs them.",
  inputSchema: z.object({ title: z.string().max(80), body: z.string().max(600) }),
  async do(note: { readonly title: string; readonly body: string }) {
    if (strictlyBlocked(`${note.title}\n${note.body}`)) {
      return { status: "error" as const, data: null, message: "Blocked: card and ID numbers never go to a phone." };
    }
    if (process.env.PUSH_URL) {
      const response = await fetch(process.env.PUSH_URL, { method: "POST", headers: { title: note.title }, body: note.body });
      if (!response.ok) return { status: "error" as const, data: null, message: `Push failed (${response.status}).` };
    }
    await record({ kind: "notification", ...note });
    return { status: "success" as const, data: { notified: true } };
  },
};
