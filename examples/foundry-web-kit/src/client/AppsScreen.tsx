import type { CSSProperties, ReactNode } from "react";
import type { AppSummary } from "../shared";
import { token as t } from "./theme";

type Account = AppSummary["accounts"][number];
type Outbound = AppSummary["outbound"][number];

export interface AppsScreenProps {
  readonly apps: ReadonlyArray<AppSummary>;
  readonly title?: ReactNode;
  readonly intro?: ReactNode;
  /** Top right, like a "Connect an app" button. */
  readonly action?: ReactNode;
  /** Top right of each app, like "On 5 bots". */
  readonly installedLabel?: (app: AppSummary) => ReactNode;
  readonly accountActions?: (app: AppSummary, account: Account) => ReactNode;
  /** Under the accounts, like an "Add another account" link. */
  readonly addAccount?: (app: AppSummary) => ReactNode;
  /** The line under an outbound transmission. */
  readonly outboundNote?: (app: AppSummary, outbound: Outbound) => ReactNode;
  readonly noAccounts?: (app: AppSummary) => ReactNode;
  readonly noTransmissions?: (app: AppSummary) => ReactNode;
  readonly noPlaybooks?: (app: AppSummary) => ReactNode;
  /** Under the playbooks, like an "Add a routine" link. */
  readonly playbookAction?: (app: AppSummary) => ReactNode;
  /** The strip at the bottom of each app: a note on the left, an action on the right. */
  readonly footer?: (app: AppSummary) => ReactNode;
  readonly footerAction?: (app: AppSummary) => ReactNode;
  readonly style?: CSSProperties;
}

const heading: CSSProperties = { margin: 0, fontFamily: t("mono"), fontSize: 12, fontWeight: 500, letterSpacing: "0.06em", color: t("muted") };
const card: CSSProperties = { display: "flex", flexDirection: "column", padding: 14, borderRadius: 12, background: t("raised"), border: `1px solid ${t("lineStrong")}` };
const quiet: CSSProperties = { margin: 0, fontSize: 14, lineHeight: 1.5, color: t("muted") };
const dot = (color: string): CSSProperties => ({ width: 8, height: 8, flex: "none", borderRadius: 999, background: color });

/**
 * The Apps screen: per app, the accounts it holds, its transmissions in and
 * out, and the playbooks that take what comes in. Feed it appsSummary().
 */
export function AppsScreen(props: AppsScreenProps) {
  const { apps, title = "Apps", intro, action, style } = props;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28, color: t("text"), ...style }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 640 }}>
          <h1 style={{ margin: 0, fontSize: 32, fontWeight: 600 }}>{title}</h1>
          {intro ? <p style={{ margin: 0, fontSize: 16, lineHeight: 1.55, color: t("muted") }}>{intro}</p> : null}
        </div>
        {action}
      </div>
      {apps.map((app) => <AppSection key={app.app} app={app} {...props} />)}
    </div>
  );
}

function AppSection({ app, ...props }: AppsScreenProps & { readonly app: AppSummary }) {
  const headingId = `app-${app.app}`;
  const column = (last: boolean): CSSProperties => ({ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 14, ...(last ? {} : { borderRight: `1px solid ${t("line")}` }) });
  const footer = props.footer?.(app);
  const footerAction = props.footerAction?.(app);
  return (
    <section aria-labelledby={headingId} data-app={app.app} style={{ background: t("surface"), border: `1px solid ${t("line")}`, borderRadius: 16, overflow: "hidden" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "20px 24px", borderBottom: `1px solid ${t("line")}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span aria-hidden="true" style={{ width: 40, height: 40, flex: "none", borderRadius: 10, background: t("line"), display: "flex", alignItems: "center", justifyContent: "center", fontFamily: t("mono"), fontSize: 15 }}>
            {app.name.charAt(0).toUpperCase()}
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <h2 id={headingId} style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{app.name}</h2>
            <span style={{ fontSize: 14, color: t("muted") }}>{app.description}</span>
          </div>
        </div>
        <span style={{ fontSize: 14, color: t("muted") }}>{props.installedLabel?.(app) ?? `On ${app.installedOn} ${app.installedOn === 1 ? "agent" : "agents"}`}</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: 0 }}>
        <div style={column(false)}>
          <h3 style={heading}>ACCOUNTS</h3>
          {app.accounts.length === 0 ? <p style={quiet}>{props.noAccounts?.(app) ?? "No account connected yet."}</p> : null}
          {app.accounts.map((account) => (
            <div key={account.id} style={{ ...card, gap: 10 }}>
              <span style={{ fontSize: 15, overflowWrap: "anywhere" }}>{account.label}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: account.status === "connected" ? t("ok") : t("ask") }}>
                <span aria-hidden="true" style={dot(account.status === "connected" ? t("ok") : t("ask"))} />
                {account.status === "connected" ? "Connected" : account.status === "error" ? "Needs attention" : "Not checked yet"}
              </span>
              {props.accountActions?.(app, account)}
            </div>
          ))}
          {props.addAccount?.(app)}
        </div>

        <div style={column(false)}>
          <h3 style={heading}>TRANSMISSIONS</h3>
          {app.inbound.length + app.outbound.length === 0 ? <p style={quiet}>{props.noTransmissions?.(app) ?? "None. Nothing comes in or goes out through this app."}</p> : null}
          {app.inbound.map((inbound) => (
            <div key={`in-${inbound.name}`} style={{ ...card, gap: 6 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15 }}>
                <span style={{ fontFamily: t("mono"), fontSize: 12, color: t("accent") }}>IN</span>{inbound.name}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: t("muted") }}>
                <span aria-hidden="true" style={dot(inbound.watching ? t("ok") : t("muted"))} />
                {inbound.watching ? `Watching ${inbound.watching}` : "Not watching an account"}
              </span>
            </div>
          ))}
          {app.outbound.map((outbound) => (
            <div key={`out-${outbound.name}`} style={{ ...card, gap: 6 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15 }}>
                <span style={{ fontFamily: t("mono"), fontSize: 12, color: t("ask") }}>OUT</span>{outbound.name}
              </span>
              <span style={{ fontSize: 13, color: t("muted") }}>
                {props.outboundNote?.(app, outbound) ?? (outbound.asks ? "Asks you before each one" : "Goes out without asking")}
              </span>
            </div>
          ))}
        </div>

        <div style={column(true)}>
          <h3 style={heading}>PLAYBOOKS</h3>
          {app.playbooks.length === 0 ? <p style={quiet}>{props.noPlaybooks?.(app) ?? (app.inbound.length === 0 ? "None, since nothing comes in." : "None yet.")}</p> : null}
          {app.playbooks.map((playbook) => (
            <div key={playbook.name} style={{ ...card, gap: 10 }}>
              <span style={{ fontSize: 15 }}>{playbook.name}</span>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8, fontSize: 14, lineHeight: 1.45 }}>
                {playbook.handledBy.map((handler) => (
                  <li key={handler.agentId}>
                    <b>{handler.agent}</b>{handler.does ? <> <span style={{ color: t("muted") }}>{handler.does}</span></> : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {props.playbookAction?.(app)}
        </div>
      </div>

      {footer || footerAction ? (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "16px 24px", borderTop: `1px solid ${t("line")}`, fontSize: 14, color: t("muted") }}>
          <span>{footer}</span>
          {footerAction}
        </div>
      ) : null}
    </section>
  );
}
