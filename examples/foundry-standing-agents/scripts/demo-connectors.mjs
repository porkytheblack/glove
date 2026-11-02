import { withDemoEnv } from "glove-foundry-web-kit/demo-env";

// With DEMO_CONNECTORS=1 the web app serves a mock Slack and mock mail
// (app/mock, app/(dot)/demo): Slack's signing secret, the bot token and the
// Web API's address point at the mock, and mock mail is signed. Both
// processes get the same values, because Foundry posts and the web app
// checks.
export const demoEnv = (env) => withDemoEnv(env, (secret, web) => ({
  SLACK_SIGNING_SECRET: secret("slack-signing"),
  SLACK_BOT_TOKEN: secret("slack-bot"),
  SLACK_API_URL: `${web}/mock/slack/api`,
  MOCK_MAIL_SECRET: secret("mail"),
}));
