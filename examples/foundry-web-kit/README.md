# Foundry web kit

The shared web layer for the Foundry examples' person-facing apps (Crew,
the personal agent, Dot). Each product is a Next.js app in its example
package; this kit is what they have in common: sign-in by invite link, the
workspace checks, a live run relay, and the chat, approval and apps
components. It is TypeScript source, consumed with Next's
`transpilePackages: ["glove-foundry-web-kit"]`.

```
  browser ──► the app's server (Next route handlers) ──► Foundry on loopback
              session cookie, workspace checks,            FOUNDRY_TOKEN
              reduced shapes only
```

Foundry has no per-person auth and sends no CORS headers, so the browser
never talks to it. The app's server holds `FOUNDRY_TOKEN`, checks that the
signed-in person's workspace (their id) owns whatever a request names, and
sends the browser display shapes only: no tokens, system prompts, raw tool
input or results.

## Server: `glove-foundry-web-kit/server`

| Export | What it does |
| --- | --- |
| `foundry()` | The typed Foundry client: `FOUNDRY_URL` (default `http://127.0.0.1:4141`) with `Bearer FOUNDRY_TOKEN` when set. |
| `createInvite(personId)`, `verifyInvite(token)` | Invite tokens `personId.expiresAt.mac`, HMAC-SHA256 with `WEB_SESSION_SECRET`, 7 days, compared with `timingSafeEqual`. |
| `sessionCookie(personId, { secure })`, `readSession(value)`, `clearedSessionCookie(secure)` | The `session` cookie: HttpOnly, SameSite=Lax, Secure over https, 30 days. Invite and session MACs are keyed apart. |
| `devSignIn()` | True in development with no `WEB_SESSION_SECRET`: the sign-in page may offer demo people. Production refuses to sign anything without the secret. |
| `requirePerson()`, `currentPerson()` | The signed-in person (`{ id }`, also their workspace) from the cookie; `requirePerson` throws a 401. |
| `handle(fn)`, `HttpError`, `notFound()` | Wrap a route handler: an `HttpError` becomes its status and message, anything else a plain 500. |
| `ownedAgent`, `ownedAgents`, `ownedConversation`, `ownedRun`, `ownedApproval` | Fetch the record from Foundry and check its `workspaceId`; anything else is a 404, like a missing record. |
| `displayMessages(transcript, { incoming?, describeTool? })` | A Glove transcript as `{ id, sender: "person" \| "agent" \| "event", text, tools?: [{ name, status, label?, chip? }] }`. Tool input stays on the server; `describeTool` turns it into a short line. |
| `liveRun(runId, { after, signal, describeTool? })`, `resumeAfter(request)` | A server-sent event `Response` that follows Foundry's events for one run and re-emits only `agent.text_delta {text}`, `agent.tool_use {name}`, `agent.tool_use_result {name, status}`, `agent.foundry.approval.requested {approvalId, toolName}`, `approval.resolved`, `run.started/completed/failed/cancelled`. Ends with the run; resumes from `Last-Event-ID`. |
| `pendingApprovals(workspaceId, { describe?, filter? })` | The workspace's pending approvals with the tool name and only the fields a person needs (to, subject, body, title…). `describe` sets the title and whether "Always allow" is offered. |
| `appsSummary(workspaceId, agentIds, options?)` | Per app: its accounts (only those installed on the person's agents), inbound transmissions (with "Watching <account>" when a connection runs), outbound ones, and the playbooks that take what comes in, with the agents that run them. |

A route in a product:

```ts
export const GET = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const person = await requirePerson();
  const run = await ownedRun(person.id, (await params).id);
  return liveRun(run.id, { after: resumeAfter(request), signal: request.signal });
});
```

## Client: `glove-foundry-web-kit/client`

| Export | What it does |
| --- | --- |
| `Thread` | Messages, then what is streaming, then children (approval cards). Consecutive agent messages form one turn; `authorOf` adds avatars in a group. Keeps the newest in view. |
| `Message`, `Turn`, `Chip` | One message; an agent's turn with its tool lines above each reply and handoff chips below. |
| `Composer` | A message box and Send. Enter sends, Shift+Enter adds a line; `onSend` throws to keep the text. |
| `ApprovalCard` | Allow once / Always allow (when `canAlwaysAllow`) / Deny, with the approval's fields and body. |
| `useLiveRun(runId, { onApproval?, onEnd? })` | Follows `/api/runs/<id>/live` with EventSource and returns the reply so far as display messages. Closes on the run's end. |
| `AppsScreen` | The Apps screen from `appsSummary()`, with slots for the product's words and actions. |

### Theme

Components read CSS variables; set them on `:root` or a wrapper (or use
`themeStyle({ … })`). The fallbacks are a plain light theme.

| Variable | Used for |
| --- | --- |
| `--kit-font`, `--kit-mono` | Body text; tool lines and headings |
| `--kit-bg`, `--kit-surface`, `--kit-raised` | Ground; cards and the composer; bubbles and inner cards |
| `--kit-line`, `--kit-line-strong` | Hairlines; button and inner-card borders |
| `--kit-text`, `--kit-muted` | Text; secondary text |
| `--kit-accent`, `--kit-on-accent` | Links, primary buttons, live dots; text on them |
| `--kit-mine` | The person's bubble |
| `--kit-ask`, `--kit-ok` | Approvals and outbound; connected accounts |

## Tests

```bash
pnpm --filter glove-foundry-web-kit test
```

Invite and session round trips and expiry, tampered tokens, the guards
refusing another workspace, and the live relay dropping and cutting down
events.
