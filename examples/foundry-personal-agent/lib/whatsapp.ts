import { Schema } from "effect";

// WhatsApp Business Cloud API: what Muse needs to talk with people on
// WhatsApp. Muse has one business number; people message it, and Muse answers
// each person on their own number. Meta posts incoming messages to a webhook
// (lib/whatsapp-webhook.ts checks and forwards them).

const version = () => process.env.WHATSAPP_GRAPH_VERSION ?? "v23.0";

/** The parts of a webhook delivery Muse reads: one text message from a person. */
export const WhatsAppWebhook = Schema.Struct({
  object: Schema.Literal("whatsapp_business_account"),
  entry: Schema.Array(Schema.Struct({
    id: Schema.String,
    changes: Schema.Array(Schema.Struct({
      field: Schema.String,
      value: Schema.Struct({
        messaging_product: Schema.Literal("whatsapp"),
        metadata: Schema.Struct({ phone_number_id: Schema.String }),
        contacts: Schema.optional(Schema.Array(Schema.Struct({
          wa_id: Schema.String,
          profile: Schema.optional(Schema.Struct({ name: Schema.String })),
        }))),
        messages: Schema.optional(Schema.Array(Schema.Struct({
          from: Schema.String,
          id: Schema.String,
          timestamp: Schema.String,
          type: Schema.String,
          text: Schema.optional(Schema.Struct({ body: Schema.String })),
        }))),
      }),
    })),
  })),
});
export type WhatsAppWebhook = typeof WhatsAppWebhook.Type;

/** The first text message in a delivery, if there is one (status updates have none). */
export function textMessageIn(hook: WhatsAppWebhook) {
  for (const entry of hook.entry) {
    for (const change of entry.changes) {
      const message = change.value.messages?.find((item) => item.type === "text" && item.text);
      if (message?.text) {
        return {
          phoneNumberId: change.value.metadata.phone_number_id,
          messageId: message.id,
          from: message.from,
          name: change.value.contacts?.find((contact) => contact.wa_id === message.from)?.profile?.name ?? "",
          text: message.text.body,
          sentAt: new Date(Number(message.timestamp) * 1000).toISOString(),
        };
      }
    }
  }
  return undefined;
}

/** Send a text to someone who wrote in the last 24 hours. Outside that window WhatsApp only takes templates. */
export async function sendText(
  token: string,
  message: { readonly phoneNumberId: string; readonly to: string; readonly text: string },
  signal?: AbortSignal,
): Promise<{ readonly messageId: string }> {
  const response = await fetch(`https://graph.facebook.com/${version()}/${message.phoneNumberId}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: message.to,
      type: "text",
      text: { body: message.text },
    }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(`WhatsApp send: ${response.status} ${await response.text()}`);
  const data = (await response.json()) as { messages?: Array<{ id: string }> };
  return { messageId: data.messages?.[0]?.id ?? "" };
}
