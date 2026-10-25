import type { GloveFoldArgs, IGloveRunnable } from "glove-core";
import { installedApplicationTransmissionToolName, type AgentAssemblyContext } from "glove-foundry";
import { z } from "zod";
import { pay, type Purchase } from "../../lib/payments.js";
import { aroundTool } from "../../lib/tool-policy.js";
import { loginsOf } from "../../lib/vault.js";
import gmailApp from "./apps/gmail.app.js";
import { requestAccessTool } from "./sentinel.js";
import gmail from "./transmissions/gmail.transmission.js";

/** What Muse can do besides its apps: pay, ask the Sentinel's question, ask for a login. */
export function museTools(ctx: AgentAssemblyContext): GloveFoldArgs<any>[] {
  return [
    {
      name: "buy",
      description:
        "Pay for something the person asked for. You never see a card: the payment goes through a one-time card made for this merchant and amount. The person approves the exact purchase first.",
      inputSchema: z.object({
        merchant: z.string().min(1),
        items: z.array(z.string().min(1)).min(1),
        amountCents: z.number().int().positive(),
      }),
      requiresPermission: true,
      async do(purchase: Purchase) {
        const receipt = await pay(ctx.workspaceId, purchase);
        return {
          status: "success" as const,
          data: { paid: true, merchant: purchase.merchant, amountCents: purchase.amountCents, orderId: receipt.orderId, card: `one-time card ending ${receipt.cardLast4}` },
        };
      },
    },
    requestAccessTool(ctx),
    {
      name: "request_login",
      description:
        "Ask the person to add a login for a site to their vault. You can then use it by name in a script (credential: name) without ever seeing it. Never ask for a password in chat.",
      inputSchema: z.object({
        name: z.string().regex(/^[a-z][a-z0-9-]*$/).describe("A short name for the login, like bistro-luna."),
        site: z.string().url().describe("The site's origin, like https://bistro-luna.example."),
        why: z.string().min(1),
      }),
      // The approval is your app's "Add a login" form: the person types it there.
      requiresPermission: true,
      async do({ name }: { readonly name: string }) {
        const saved = name in (await loginsOf(ctx.workspaceId));
        return { status: "success" as const, data: saved ? { saved: true, credential: name } : { saved: false, note: "The person hasn't added it yet." } };
      },
    },
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
