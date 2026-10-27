"use client";

import Link from "next/link";
import { DeliveryLog, MockMail, useDemoState } from "glove-foundry-web-kit/client";
import type { DemoState } from "../server/demo";
import { postJson } from "./api";

/**
 * The demo connector: deliver new mail to your Gmail. It goes out as a signed
 * webhook to this app's public address, each bot with a routine on new mail
 * wakes in its chat, and the log shows every hop.
 */
export function Demo() {
  const { data, refresh } = useDemoState<DemoState>("/api/demo");

  async function send(body: Record<string, unknown>) {
    await postJson("/api/demo", body);
    refresh();
  }

  return (
    <div className="cards wide">
      <div className="demo-col">
        {data && !data.email ? (
          <p className="notice">Connect Gmail on the <Link href="/apps">Apps</Link> page first. The sample account is enough.</p>
        ) : data?.email ? (
          <MockMail
            title="Gmail"
            to={data.email}
            defaults={{ from: "Lena Park <lena@northwind.example>", subject: "Export API pricing?", body: "Hi, what does the export API cost for a team of 40? We'd like to start next month." }}
            onSend={(mail) => send({ kind: "mail", ...mail })}
          />
        ) : null}
        {data?.woke.length ? (
          <section className="card" aria-label="Bots that woke">
            <h2>Woke for the latest mail</h2>
            <p>Each one works in its own chat. Sends wait there for your approval.</p>
            <ul className="bot-list">
              {data.woke.map((bot) => (
                <li key={bot.id}><Link className="bot-link" href={`/bots/${bot.id}`}>{bot.name} →</Link></li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      <DeliveryLog hops={data?.hops ?? []} />
    </div>
  );
}
