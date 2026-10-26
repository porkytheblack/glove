import { Effect } from "effect";
import type { GloveFoldArgs, IGloveRunnable } from "glove-core";
import { installedApplicationTransmissionToolName, type AgentAssemblyContext } from "glove-foundry";
import { z } from "zod";
import { kuiper } from "../../lib/kuiper.js";
import { issuer, payAtCheckout, recordPurchase, type Purchase } from "../../lib/payments.js";
import { aroundTool } from "../../lib/tool-policy.js";
import gmailApp from "./apps/gmail.app.js";
import { browserOf } from "./browser.js";
import { requestAccessTool, sentinelFor } from "./sentinel.js";
import gmail from "./transmissions/gmail.transmission.js";

/** What Muse can do besides its apps and its browser: pay, and ask the Sentinel's question. */
export function museTools(ctx: AgentAssemblyContext): GloveFoldArgs<any>[] {
  return [
    {
      name: "buy",
      description:
        "Pay at the checkout open in your browser. You never see a card: a one-time card for this merchant and amount is typed into the checkout in a tab you don't see, and submitted. The person approves the exact purchase first. Open the checkout page before calling it; the result has the page the site answered with.",
      inputSchema: z.object({
        sessionId: z.string().min(1).describe("Your browser's id, from browser.sessions()."),
        site: z.string().regex(/^[a-z0-9.-]+(:\d+)?$/).describe("The checkout's host, like fresh-market.example."),
        merchant: z.string().min(1),
        items: z.array(z.string().min(1)).min(1),
        amountCents: z.number().int().positive(),
      }),
      requiresPermission: true,
      async do({ sessionId, ...purchase }: Purchase & { readonly sessionId: string }) {
        const gateway = kuiper();
        const cards = issuer();
        if (!gateway) return { status: "error" as const, data: null, message: "You have no browser right now, so you can't pay." };
        if (!cards) return { status: "error" as const, data: null, message: "No card issuer is set up, so you can't pay yet. Tell the person." };
        // Only this Muse's own browser: Kuiper sessions belong to the whole project.
        const current = await Effect.runPromise(ctx.data.getAgent(ctx.agentId));
        if (!current || browserOf(current.context).sessionId !== sessionId) {
          return { status: "error" as const, data: null, message: "That isn't your browser. Use the id from browser.sessions()." };
        }
        const card = await cards.issue(ctx.workspaceId, purchase);
        // The person approved paying here: the checkout's requests may go, this run only.
        sentinelFor(ctx).purchaseAt(purchase.site);
        try {
          const answered = await payAtCheckout(gateway.browsers, sessionId, purchase, card);
          const last4 = await recordPurchase(ctx.workspaceId, purchase, card);
          return { status: "success" as const, data: { submitted: true, merchant: purchase.merchant, amountCents: purchase.amountCents, card: `one-time card ending ${last4}`, page: answered.page } };
        } catch (cause) {
          return { status: "error" as const, data: null, message: `The payment didn't go through: ${cause instanceof Error ? cause.message : String(cause)}. Look at the checkout before trying again.` };
        }
      },
    },
    requestAccessTool(ctx),
  ];
}

/**
 * The access the person chose for each app holds even for Foundry's own send
 * tool: with "read" access to Gmail, Muse has no send tool at all. (Foundry
 * would refuse the delivery anyway: the binding is off.)
 */
export function keepToAccess(agent: IGloveRunnable, ctx: Pick<AgentAssemblyContext, "installations">): void {
  const mail = ctx.installations.find((item) => item.kind === "application" && item.id === gmailApp.id);
  if ((mail?.config as { access?: string } | undefined)?.access !== "act") {
    aroundTool(agent, installedApplicationTransmissionToolName(gmailApp, gmail), () => undefined);
  }
}
