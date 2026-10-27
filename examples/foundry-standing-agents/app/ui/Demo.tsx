"use client";

import { useState } from "react";
import { DeliveryLog, MockChat, MockMail, useDemoState } from "glove-foundry-web-kit/client";
import type { DemoState, SlackPlace } from "../server/demo";
import { postJson } from "./api";

const PLACES: ReadonlyArray<SlackPlace> = ["dm", "channel", "teammate"];

/**
 * The demo connectors: write to the dot on a mock Slack (your DM, a mention
 * in #feedback, or a teammate's DM it ignores) and deliver new mail to the
 * support inbox. Each goes out as a signed webhook to this app's public
 * address, and the log shows every hop.
 */
export function Demo() {
  const { data, refresh } = useDemoState<DemoState>("/api/demo");
  const [place, setPlace] = useState<SlackPlace>("dm");
  const dot = data?.dot ?? "your dot";

  async function send(body: Record<string, unknown>) {
    await postJson("/api/demo", body);
    refresh();
  }

  const subtitle = {
    dm: `Your DM with ${dot}`,
    channel: `#feedback, mentioning @${dot}`,
    teammate: `A teammate's DM. ${dot} only answers you.`,
  }[place];

  return (
    <div className="demo">
      <div className="demo-col">
        {data?.slack === false ? <p className="note">{dot} isn&apos;t in Slack.</p> : (
          <MockChat
            title="Slack"
            subtitle={subtitle}
            bubbles={data?.conversations[place] ?? []}
            label={`Message ${dot} in Slack`}
            placeholder={place === "channel" ? `@${dot} …` : `Message ${dot}`}
            empty={place === "teammate" ? `A teammate's message reaches ${dot}, which only answers you, so nothing comes back.` : `Write to ${dot} the way you would in Slack.`}
            onSend={(text) => send({ kind: "slack", place, text })}
            controls={(
              <div role="group" aria-label="Write in" className="segments">
                {PLACES.map((item) => (
                  <button key={item} type="button" aria-pressed={place === item} onClick={() => setPlace(item)}>
                    {data?.places?.[item].label ?? item}
                  </button>
                ))}
              </div>
            )}
          />
        )}
        {data?.email ? (
          <MockMail
            title="Gmail"
            to={data.email}
            defaults={{ from: "Dana Ruiz <dana@acme.test>" }}
            onSend={(mail) => send({ kind: "mail", ...mail })}
          />
        ) : null}
      </div>
      <DeliveryLog hops={data?.hops ?? []} />
    </div>
  );
}
