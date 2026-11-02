"use client";

import { useState } from "react";
import { DeliveryLog, MockChat, MockMail, useDemoState } from "glove-foundry-web-kit/client";
import type { DemoState } from "../server/demo";
import { postJson } from "./api";

/**
 * The demo connectors: write to Muse on a mock WhatsApp, from your phone or a
 * stranger's, and deliver new mail to your Gmail. Each goes out as a signed
 * webhook to this app's public address, and the log shows every hop.
 */
export function Demo({ name }: { readonly name: string }) {
  const { data, refresh } = useDemoState<DemoState>("/api/demo");
  const [from, setFrom] = useState<"me" | "stranger">("me");
  const number = from === "me" ? data?.phone : data?.stranger;
  const bubbles = (number && data?.whatsapp[number]) || [];

  async function send(body: Record<string, unknown>) {
    await postJson("/api/demo", body);
    refresh();
  }

  return (
    <>
      <MockChat
        title="WhatsApp"
        subtitle={from === "me" ? `Your phone, writing to ${name}` : `A number ${name} doesn't know`}
        bubbles={bubbles}
        label={`Message ${name} on WhatsApp`}
        placeholder={from === "me" ? `Message ${name}` : "Write as a stranger"}
        empty={from === "me" ? `Write to ${name} the way you would on WhatsApp.` : `${name} only answers you, so a stranger gets nothing back.`}
        onSend={(text) => send({ kind: "whatsapp", from, text })}
        controls={(
          <div role="group" aria-label="Write from" className="segmented">
            <button type="button" aria-pressed={from === "me"} onClick={() => setFrom("me")}>Your phone</button>
            <button type="button" aria-pressed={from === "stranger"} onClick={() => setFrom("stranger")}>A stranger</button>
          </div>
        )}
      />
      {data?.email ? (
        <MockMail
          title="Gmail"
          to={data.email}
          defaults={{ from: "Leo Martin <leo@example.com>" }}
          onSend={(mail) => send({ kind: "mail", ...mail })}
        />
      ) : null}
      <DeliveryLog hops={data?.hops ?? []} />
    </>
  );
}
