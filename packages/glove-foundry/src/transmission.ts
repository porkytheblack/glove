import type { AgentPlaybook } from "./playbook.js";

function escapeXml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}

function data(value: unknown): string {
  return escapeXml(JSON.stringify(stable(value)) ?? "null");
}

/** Deterministic default rendering for an event merged into a Glove conversation. */
export function serializeInboundTransmissionXml(input: {
  readonly transmissionId: string;
  readonly routeId: string;
  readonly eventId: string;
  readonly eventName: string;
  readonly threadKey: string;
  readonly event: unknown;
  readonly playbooks: ReadonlyArray<AgentPlaybook>;
}): string {
  const playbooks = input.playbooks.map((playbook) => {
    const directives = playbook.directives.map((directive) =>
      `      <directive action="${escapeXml(directive.action)}">\n` +
      `        <instruction>${escapeXml(directive.instruction)}</instruction>` +
      (directive.parameters
        ? `\n        <parameters format="json">${data(directive.parameters)}</parameters>`
        : "") +
      `\n      </directive>`,
    ).join("\n");
    const outbound = (playbook.outbound ?? []).map((target) =>
      `      <outbound route="${escapeXml(target.routeId)}"` +
      (target.applicationId ? ` application="${escapeXml(target.applicationId)}"` : "") +
      (target.event ? ` event="${escapeXml(target.event)}"` : "") +
      (target.accountId ? ` account="${escapeXml(target.accountId)}"` : "") +
      (target.applicationAccountId ? ` application-account="${escapeXml(target.applicationAccountId)}"` : "") +
      `>` + (target.instruction ? escapeXml(target.instruction) : "") + `</outbound>`,
    ).join("\n");
    return `  <playbook id="${escapeXml(playbook.id)}">\n` +
      `${directives}` +
      (outbound ? `\n${outbound}` : "") +
      (playbook.serialization
        ? `\n      <serialization format="json">${data(playbook.serialization)}</serialization>`
        : "") +
      `\n  </playbook>`;
  }).join("\n");

  return `<transmission direction="inbound" definition="${escapeXml(input.transmissionId)}" route="${escapeXml(input.routeId)}" event="${escapeXml(input.eventName)}" event-id="${escapeXml(input.eventId)}" thread="${escapeXml(input.threadKey)}">\n` +
    `  <payload format="json">${data(input.event)}</payload>\n` +
    `${playbooks}\n` +
    `</transmission>`;
}
