import Link from "next/link";
import { AppsScreen, type AppSummary } from "glove-foundry-web-kit/client";

const APP_NAMES: Record<string, string> = { gmail: "Gmail", linear: "Linear" };

/** What each app does without asking: product copy, next to the rules kept per bot. */
const READS: Record<string, string> = {
  gmail: "Reads through Gmail's own server: search, open threads and messages, list drafts and labels, draft a reply. They run without asking.",
  linear: "Reads run without asking. Filing an issue asks you first.",
};

const ERRORS: Record<string, string> = {
  "not-set-up": "That app can't be connected on this server yet: it has no sign-in client for the provider.",
  "sign-in": "The sign-in didn't finish, so nothing was connected. Try again.",
};

const sentence = (text: string) => {
  const plain = text.replace(/^[\w ]+: /, "");
  return plain.charAt(0).toUpperCase() + plain.slice(1);
};

/** Crew's Apps screen: the kit's AppsScreen with Crew's words and links. */
export function AppsView({ apps, connectable, profileHref, error, connected }: {
  readonly apps: ReadonlyArray<AppSummary>;
  readonly connectable: ReadonlyArray<{ readonly app: string; readonly ready: boolean }>;
  readonly profileHref?: string;
  readonly error?: string;
  readonly connected?: string;
}) {
  return (
    <>
      {error ? <p className="notice" role="alert">{ERRORS[error] ?? ERRORS["sign-in"]}</p> : null}
      {connected ? <p className="notice" role="status" style={{ borderColor: "var(--kit-ok)" }}>{APP_NAMES[connected] ?? connected} is connected on every one of your bots.</p> : null}
      <AppsScreen
        apps={apps.map((app) => ({ ...app, description: sentence(app.description) }))}
        intro="An app holds the accounts you connect. What comes in is handled by a playbook. What goes out waits for your say."
        action={(
          <details className="menu">
            <summary className="button primary">Connect an app</summary>
            <div className="menu-items">
              {connectable.map(({ app, ready }) => ready
                ? <a key={app} href={`/api/apps/${app}/connect`} className="button wide" style={{ display: "flex", alignItems: "center", textDecoration: "none" }}>{APP_NAMES[app] ?? app}</a>
                : <span key={app}>{APP_NAMES[app] ?? app}: not set up on this server</span>)}
            </div>
          </details>
        )}
        installedLabel={(app) => `On ${app.installedOn} ${app.installedOn === 1 ? "bot" : "bots"}`}
        accountActions={(app) => connectable.some((item) => item.app === app.app && item.ready)
          ? <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}><a href={`/api/apps/${app.app}/connect`} className="button" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none", borderRadius: 8 }}>Reconnect</a></div>
          : null}
        noAccounts={(app) => `No ${app.name} account yet. A bot asks for it when it needs it, or connect it here.`}
        outboundNote={(_app, outbound) => outbound.asks ? "Asks you before each email" : "Goes out without asking"}
        noTransmissions={(app) => `None. ${app.name} works through reads and writes here; no messages come in or go out.`}
        noPlaybooks={(app) => app.inbound.length === 0 ? "None, since nothing comes in." : "None yet. Add a routine on new mail to a bot."}
        playbookAction={(app) => app.inbound.length > 0 && profileHref ? <Link href={profileHref} style={{ fontSize: 14 }}>Add a routine on a bot</Link> : null}
        footer={(app) => READS[app.app]}
        footerAction={() => profileHref ? <Link href={profileHref} style={{ fontSize: 14 }}>Always allow, always ask</Link> : null}
      />
    </>
  );
}
