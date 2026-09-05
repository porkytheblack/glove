export interface DeliveredMessage {
  readonly id: string;
  readonly channel: string;
  readonly text: string;
  readonly deliveredAt: string;
}

const messages: DeliveredMessage[] = [];

export function recordDelivery(channel: string, text: string): DeliveredMessage {
  const message = Object.freeze({
    id: `delivery-${messages.length + 1}`,
    channel,
    text,
    deliveredAt: new Date().toISOString(),
  });
  messages.push(message);
  return message;
}

export function listDeliveries(): ReadonlyArray<DeliveredMessage> {
  return Object.freeze([...messages]);
}
