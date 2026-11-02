import { handle, notFound, requirePerson } from "glove-foundry-web-kit/server";
import { teamOf } from "../../server/dot";
import { host } from "../../server/host";

const TEXT = /\.(md|txt|csv|json|diff|patch|log|ts|js|py|html|css|ya?ml)$/i;

/**
 * One file from the computer of the person's dot or builder. Text is shown as
 * plain text; anything else downloads. Neither runs as a page here.
 */
export const GET = handle(async (request: Request) => {
  const person = await requirePerson();
  const url = new URL(request.url);
  const agentId = url.searchParams.get("agent") ?? "";
  const path = url.searchParams.get("path") ?? "";
  const team = await teamOf(person.id);
  const agent = [team?.dot, team?.builder].find((item) => item && item.id === agentId);
  if (!agent || !path) throw notFound();
  const file = await (await host()).computer.computerFile(agent, path);
  if (!file) throw notFound();
  const name = path.split("/").at(-1)!.replace(/[^\w.-]+/g, "_") || "file";
  return new Response(new Uint8Array(file), {
    headers: {
      "content-type": TEXT.test(path) ? "text/plain; charset=utf-8" : "application/octet-stream",
      "content-disposition": `${TEXT.test(path) ? "inline" : "attachment"}; filename="${name}"`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'",
      "cache-control": "no-store",
    },
  });
});
