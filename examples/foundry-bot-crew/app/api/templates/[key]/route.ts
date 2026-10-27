import { foundry, handle, notFound, requirePerson } from "glove-foundry-web-kit/server";

/** One of the person's saved templates as a file, to share. It carries no chats, accounts or keys. */
export const GET = handle(async (_request: Request, { params }: { params: Promise<{ key: string }> }) => {
  const person = await requirePerson();
  const key = decodeURIComponent((await params).key);
  const entry = (await foundry().workspaceEntries(person.id)).find((item) => item.key === key && key.startsWith("template:"));
  if (!entry) throw notFound();
  const name = String((entry.value as { name?: string }).name ?? "template").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return new Response(`${JSON.stringify(entry.value, null, 2)}\n`, {
    headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${name}.template.json"` },
  });
});
