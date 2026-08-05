---
"glove-working-environment": minor
---

`defineTools` and `present` — capabilities go in, deliverables come out

Two additions that turn the environment from a place to *compute* into a place to *compose*.

### `defineTools` — mount any capability as an `env:` module

A fourth authoring route, beside `defineAdapter`, `defineBuilder` and `definePureModule`. The first three wrap libraries; this one wraps whatever the host already has as a tool — an MCP server, a Glove tool, or a plain async function.

```ts
import { defineTools } from "glove-working-environment";
import { fnsFromMcp, fnFromTool, defineFn } from "glove-scratchpad/fns";

const env = await createWorkingEnvironment({
  stdlib: [
    documents(),
    slides(),
    defineTools({ name: "github", fns: await fnsFromMcp(gh) }),
    defineTools({
      name: "workspace",
      fns: [fnFromTool(searchInbox), defineFn({ name: "today", handler: todayIso })],
      docs: "Tokens belong to the workspace bot. `since` is inclusive.",
    }),
  ],
});
```

**A tool call puts its whole result in the context window. A tool call from a script puts the result in a variable.** That is the whole argument, and it is the same context discipline this environment already applies to files, applied to capabilities:

```js
import { list_pull_requests } from 'env:github';
import { create } from 'env:slides';

export default async function () {
  const prs = await list_pull_requests({ repo: 'you/repo', since: '2026-08-01' });
  const byAuthor = Object.groupBy(prs, (p) => p.author);
  await create('/out/week.pptx', {
    slides: Object.entries(byAuthor).map(([author, items]) => ({
      title: author, bullets: items.map((p) => p.title),
    })),
  });
  return `${prs.length} PRs from ${Object.keys(byAuthor).length} people`;
}
```

Two hundred pull requests, a thousand emails, a year of calendar events — the model writes the loop that reduces them and only the last line comes back. And because the capability lands beside `env:documents` and `env:slides`, "a PDF of all my emails" stops being two systems and becomes one script.

`ToolFn` is declared **structurally**, not imported, so `glove-scratchpad/fns`' `defineFn` / `fnFromTool` / `fnsFromMcp` drop straight in while this package keeps its zero dependencies — anything matching `{ name, description?, inputSchema?, call(args) }` qualifies. A cross-package test in `glove-scratchpad` holds the two shapes together, since neither package's own build would notice them drifting.

Details that matter in practice. Names are checked as JS identifiers at definition time, because a script binds them as one — MCP's `server__tool` already qualifies, a dash fails with the rename attached rather than producing an unimportable module. Types and docs are generated from the input schemas, with enums as unions rather than `string`. And **write-time validation cannot fire a real effect**: every script write executes the module's top level against a read-only environment, which for a filesystem adapter is merely wasteful but for a capability would mean the email goes out when the script is *saved*. A top-level call is refused, with the fix.

### `present` — hand a finished file over

Writing to `/out` makes a file; `present` delivers it. The distinction earns its keep because `/out` accumulates — drafts, a superseded version, the spreadsheet that fed the report — and only the agent knows which of those was the answer.

```ts
const env = await createWorkingEnvironment({
  onPresent: async ({ name, bytes, mediaType, caption }) => {
    await sendToUser({ name, bytes, mediaType, caption });
  },
});
```

Wired on the same terms as `vision`/`view_image`: no receiver, no verb, so an agent is never shown a capability that would fail on use. A matching `/skills/delivering.md` appears and disappears with it, because a recipe for a verb that is not offered is how an agent learns to hallucinate the call.

The path must be under `/out`. Presenting from `/tmp` would ship an intermediate and presenting from `/inbox` would echo the person's own upload back at them as work — the refusal names the fix, and making the agent copy the file first *is* the check. The caption is required and an empty one is refused with an example, since the person reads it in place of the filename. `mediaType` follows the extension the agent chose, so the label agrees with the name; magic bytes only settle the extensionless case.
