import { withDemoEnv } from "glove-foundry-web-kit/demo-env";

// With DEMO_CONNECTORS=1 the web app serves a mock WhatsApp and mock mail
// (app/mock, app/(muse)/demo): Meta's webhook secrets, Muse's WhatsApp token
// and the Graph API's address point at the mock, and mock mail is signed.
// Both processes get the same values, because Foundry sends and the web app
// checks.
export const demoEnv = (env) => withDemoEnv(env, (secret, web) => ({
  WHATSAPP_APP_SECRET: secret("whatsapp-app"),
  WHATSAPP_VERIFY_TOKEN: secret("whatsapp-verify"),
  WHATSAPP_TOKEN: secret("whatsapp-token"),
  WHATSAPP_GRAPH_URL: `${web}/mock/whatsapp`,
  MOCK_MAIL_SECRET: secret("mail"),
}));
