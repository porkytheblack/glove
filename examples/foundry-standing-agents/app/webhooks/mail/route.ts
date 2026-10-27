import { mockMailWebhook } from "glove-foundry-web-kit/server";
import { host } from "../../server/host";

// New mail for a sample account, from the mock mail on the demo page. Only
// with DEMO_CONNECTORS=1; real Gmail arrives through the Gmail watch instead.

export const dynamic = "force-dynamic";

export const POST = mockMailWebhook(async () => {
  const app = await host();
  return { dataDir: app.dataDir, arrive: app.arrive, inboundRoute: (accountId) => app.connect.gmailRoutes(accountId).in };
});
