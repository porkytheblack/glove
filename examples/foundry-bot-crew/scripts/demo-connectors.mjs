import { withDemoEnv } from "glove-foundry-web-kit/demo-env";

// With DEMO_CONNECTORS=1 the web app serves a mock mail (app/(crew)/demo):
// mail it delivers to a sample Gmail account is signed with this secret, and
// app/webhooks/mail takes only signed mail. Both processes get the same value.
export const demoEnv = (env) => withDemoEnv(env, (secret) => ({
  MOCK_MAIL_SECRET: secret("mail"),
}));
