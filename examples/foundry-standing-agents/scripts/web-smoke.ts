import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright-core";

// The web app end to end, offline: Foundry and the web app run as one unit
// (scripts/start.mjs) with scripted models (DOTS_DEMO=1), and a real browser
// drives it.
//   1. Sam opens his invite link and is signed in; the session cookie is HttpOnly.
//   2. He writes to Pip and the reply streams in.
//   3. Research runs (as its schedule starts it): read only, with a suggestion. "Go ahead" acts on it.
//   4. He asks Pip to reply to Dana; the email waits in an approval card; he approves it and it goes out.
//   5. Activity: a hand-off (merging is his), a follow-up in his time zone, a file on Pip's computer,
//      an email that asks first, which he redirects. He marks the hand-off done.
//   6. Rules: he sets merging to "act without asking"; built-in safety stays locked.
//   7. He pauses Pip and resumes it.
//   8. Apps: the mailbox and Slack, what comes in and goes out, and the playbooks.
//   9. Ada's dot, run, approval, hand-off and files answer 404; no session answers 401; a forged link signs no one in.
//  10. He signs out.
// Needs a build (`pnpm build`; run here if missing) and Chromium (CHROMIUM_PATH, default /opt/pw-browsers/chromium).
// WEB_SMOKE_SHOTS=<dir> also saves a screenshot of each screen at 1440×900.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const chromiumPath = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";
const shots = process.env.WEB_SMOKE_SHOTS;

if (!existsSync(join(root, ".next", "BUILD_ID"))) {
  assert.equal(spawnSync("pnpm", ["build"], { cwd: root, stdio: "inherit" }).status, 0, "next build");
}

const freePort = () => new Promise<number>((resolvePort, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address() as { port: number };
    server.close(() => resolvePort(port));
  });
});

async function until<T>(read: () => Promise<T | undefined>, what: string, timeoutMs = 90_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read().catch(() => undefined);
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise((wait) => setTimeout(wait, 250));
  }
}

const dataDir = await mkdtemp(join(tmpdir(), "dots-web-"));
const [webPort, foundryPort] = [await freePort(), await freePort()];
const web = `http://127.0.0.1:${webPort}`;
const foundryUrl = `http://127.0.0.1:${foundryPort}`;
const token = randomBytes(24).toString("base64url");
const { SLACK_BOT_TOKEN: _slack, ...inherited } = process.env;
const env = {
  ...inherited,
  DOTS_DEMO: "1",
  DOTS_DATA_DIR: dataDir,
  FOUNDRY_TOKEN: token,
  FOUNDRY_PORT: String(foundryPort),
  WEB_SESSION_SECRET: randomBytes(32).toString("base64url"),
  WEB_URL: web,
  PORT: String(webPort),
};

let log = "";
const unit = spawn(process.execPath, ["scripts/start.mjs"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
unit.stdout.on("data", (chunk) => { log += chunk; });
unit.stderr.on("data", (chunk) => { log += chunk; });
const asFoundry = (path: string, init: RequestInit = {}) =>
  fetch(`${foundryUrl}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers } });
const foundryJson = async <T>(path: string, init?: RequestInit) => {
  const response = await asFoundry(path, init);
  assert.ok(response.ok, `${init?.method ?? "GET"} ${path}: ${response.status} ${await response.clone().text()}`);
  return await response.json() as T;
};
type Run = { id: string; status: string };
const finished = (runId: string) => until(async () => {
  const run = await foundryJson<Run>(`/api/runs/${runId}`);
  return ["completed", "failed", "cancelled"].includes(run.status) ? run : undefined;
}, `run ${runId}`);
const pip = async () => (await foundryJson<Array<{ id: string; context: Record<string, unknown> }>>("/api/agent-instances?definition=dot")).find((item) => item.id === "sam-dot")!;
const shoot = async (page: Page, name: string) => {
  if (!shots) return;
  await mkdir(shots, { recursive: true });
  await page.screenshot({ path: join(shots, `dot-${name}.png`) });
};

const browser = await chromium.launch({ executablePath: chromiumPath });
try {
  await until(async () => (await fetch(`${web}/welcome`)).ok || undefined, "the web app");
  await until(async () => (await asFoundry("/health")).ok || undefined, "Foundry");

  // Ada's dot, in her own workspace: a run, a hand-off and an approval Sam must never reach.
  const adaContext = {
    name: "Juniper", owner: "Ada", kind: "primary", paused: false,
    responsibilities: [{ job: "Watch the support inbox.", sources: ["support inbox"], attention: "", mustNot: "" }],
    rules: { merge_pr: "block", open_draft_pr: "ask" },
    routing: { progress: "app", decisions: "app" },
  };
  assert.equal((await asFoundry("/api/agent-instances", {
    method: "POST",
    body: JSON.stringify({ definitionId: "dot", id: "ada-dot", workspaceId: "ada", name: "Juniper", description: "Ada's dot", context: adaContext }),
  })).status, 201);
  await foundryJson("/api/conversations", { method: "POST", body: JSON.stringify({ agentId: "ada-dot", id: "ada-dot-app", context: { conversationKey: "app" } }) });
  const adaMessage = (message: string) => foundryJson<Run>("/api/conversations/ada-dot-app/messages", { method: "POST", body: JSON.stringify({ agentId: "ada-dot", message }) });
  const adaRun = await adaMessage("Merge the fix PR, #7.");
  await finished(adaRun.id);
  const adaDraft = await adaMessage("Open a draft PR for the CSV export fix.");
  const adaApproval = await until(async () =>
    (await foundryJson<Array<{ id: string; runId: string }>>("/api/approvals?status=pending")).find((item) => item.runId === adaDraft.id), "Ada's approval");

  // 1. The invite link, as `pnpm invite sam` prints it.
  const invite = spawnSync(process.execPath, ["--import", "tsx", "scripts/invite.ts", "sam"], { cwd: root, env, encoding: "utf8" }).stdout.trim();
  assert.match(invite, new RegExp(`^${web}/signin\\?t=sam\\.\\d+\\.[\\w-]+$`));
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${web}/welcome`);
  await shoot(page, "signin");
  // Keep every live event the page receives, to check what reached the browser.
  await page.addInitScript(() => {
    const Native = window.EventSource;
    const seen: string[] = [];
    (window as unknown as { __live: string[] }).__live = seen;
    window.EventSource = class extends Native {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        this.addEventListener("message", (event) => seen.push((event as MessageEvent<string>).data));
      }
    };
  });
  await page.goto(invite);
  assert.equal(new URL(page.url()).pathname, "/");
  const session = (await context.cookies()).find((cookie) => cookie.name === "session");
  assert.ok(session?.httpOnly && session.sameSite === "Lax", "an HttpOnly, SameSite=Lax session cookie");
  await page.getByRole("heading", { name: "Pip", level: 1 }).waitFor();
  assert.ok(await page.getByText("@pip-dot · Sam's dot").isVisible());
  console.log("1. Sam opened his invite link and is signed in");

  // 2. A message, and the reply streaming in.
  const box = page.getByLabel("Message Pip");
  await box.fill("Hi Pip, it's Sam.");
  await box.press("Enter");
  await page.getByText("Got it. I'll watch my sources, group what comes in, and bring you what matters.").first().waitFor();
  const live = async () => (await page.evaluate(() => (window as unknown as { __live: string[] }).__live)).map((data) => JSON.parse(data) as { type: string } & Record<string, unknown>);
  const first = await until(async () => {
    const events = await live();
    return events.some((event) => event.type === "run.completed") ? events : undefined;
  }, "the run to end");
  const deltas = first.filter((event) => event.type === "agent.text_delta");
  assert.ok(deltas.length > 3, `the reply streamed in pieces (${deltas.length})`);
  console.log(`2. Pip's reply streamed in, ${deltas.length} pieces`);

  // 3. Research, as its schedule starts it: read only, and one suggestion.
  const research = async () => {
    const schedule = await until(async () =>
      (await foundryJson<Array<{ id: string; agentId: string; scheduleName?: string; message: string; conversationId: string }>>("/api/activations?workspace=sam"))
        .find((item) => item.agentId === "sam-dot" && item.scheduleName === "research"), "the research schedule");
    const run = await foundryJson<Run>("/api/agents/dot/runs", {
      method: "POST",
      body: JSON.stringify({ agentId: "sam-dot", conversationId: schedule.conversationId, workspaceId: "sam", message: schedule.message, source: { kind: "activation", id: schedule.id } }),
    });
    await finished(run.id);
  };
  await research();
  const card = page.getByRole("group", { name: "Suggestion from research" });
  await card.waitFor({ timeout: 30_000 });
  assert.match(await card.innerText(), /CSV export times out on large reports/);
  await page.getByText("Research · read only").first().waitFor();
  await card.getByRole("button", { name: "Go ahead" }).click();
  await page.getByText("Opened draft PR #101: Stream large CSV exports.").waitFor();
  await card.waitFor({ state: "detached" });
  console.log("3. research ran read only and brought a suggestion; \"Go ahead\" opened the draft PR");

  // 4. An email waits for his approval in the conversation.
  await box.fill("Reply to Dana at dana@acme.test and tell her the CSV fix ships Friday.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const approval = page.getByRole("group", { name: "Approval" });
  await approval.waitFor();
  const shown = await approval.innerText();
  assert.match(shown, /Pip wants to send this email/);
  assert.match(shown, /support@example\.com/);
  assert.match(shown, /dana@acme\.test/);
  assert.match(shown, /Your rule: ask first\./);
  await approval.getByRole("button", { name: "Approve" }).click();
  await page.getByText("Sent the reply to dana@acme.test.").waitFor();
  assert.match(await readFile(join(dataDir, "ledger.jsonl"), "utf8"), /"to":"dana@acme\.test"/, "the email went out from the support mailbox");
  console.log("4. the reply to Dana waited in an approval card; approved, it went out");

  // 5. Activity: what waits on him, follow-ups and files.
  for (const [message, reply] of [
    ["Merge the fix PR, #42.", "That one is yours, so I didn't do it. The details are in Slack."],
    ["Save this week's feedback summary on your computer.", "Saved /workspace/feedback-this-week.md on my computer."],
    ["Every Monday at 9am my time, open a draft PR for the week's export fixes.", "Set: every Monday at 9:00 New York time, I'll open a draft PR for the week's export fixes."],
  ] as const) {
    await box.fill(message);
    await box.press("Enter");
    await page.getByText(reply).waitFor();
    await until(async () => (await box.isEnabled()) || undefined, "the composer");
  }
  await box.fill("Reply to Ken at ken@umbrella.test about his export.");
  await box.press("Enter");
  await approval.waitFor();
  await page.getByRole("link", { name: "Activity", exact: true }).click();
  await page.getByRole("heading", { name: "Activity", level: 1 }).waitFor();
  const yours = page.getByRole("group", { name: "Yours to do" });
  await yours.getByText("Review PR #42 and merge it yourself.").waitFor();
  const askFirst = page.getByRole("group", { name: "Ask first" });
  await askFirst.getByText("ken@umbrella.test").waitFor();
  await page.getByText("Mondays 9:00, New York · acts under your rules").waitFor();
  await page.getByText("Every 2 hours · read only").waitFor();
  await page.getByRole("link", { name: "feedback-this-week.md" }).waitFor();
  await shoot(page, "activity");
  const file = await page.request.get(`${web}/api/files?agent=sam-dot&path=${encodeURIComponent("/workspace/feedback-this-week.md")}`);
  assert.equal(file.status(), 200);
  assert.match(await file.text(), /CSV export timeouts: 4/);
  assert.equal((await page.request.get(`${web}/api/files?agent=sam-dot&path=${encodeURIComponent("/skills/README.md")}`)).status(), 404, "the environment's own files aren't listed or served");
  // Redirect the run that waits on the email: it stops and starts again from his message.
  const waiting = page.locator("[data-run]").first();
  const waitingRun = await waiting.getAttribute("data-run");
  await waiting.getByRole("button", { name: "Redirect" }).click();
  await waiting.getByRole("textbox").fill("Don't email Ken. Remember that Ken prefers a call.");
  await waiting.getByRole("button", { name: "Redirect" }).click();
  assert.equal((await finished(waitingRun!)).status, "cancelled", "the redirected run stopped");
  const redirected = await until(async () => (await foundryJson<Array<Run & { input: { message?: unknown } }>>("/api/runs?agent=dot"))
    .find((run) => run.input.message === "Don't email Ken. Remember that Ken prefers a call." && run.status === "completed"), "the redirected run");
  await askFirst.waitFor({ state: "detached" });
  assert.equal((await readFile(join(dataDir, "ledger.jsonl"), "utf8")).includes("ken@umbrella.test"), false, "nothing went to Ken");
  await yours.getByRole("button", { name: "Mark done" }).click();
  await yours.waitFor({ state: "detached" });
  console.log("5. Activity: a hand-off, an email that asks first, a follow-up in his time zone, research read only, a file on Pip's computer");
  console.log(`   he redirected the waiting run (${redirected.id} took over) and marked the hand-off done`);

  // 6. Rules.
  await page.getByRole("link", { name: "Rules", exact: true }).click();
  await page.getByRole("heading", { name: "Custom Rules" }).waitFor();
  const merge = page.getByRole("group", { name: "Merge a pull request" });
  assert.equal(await merge.getByRole("button", { name: "Hand off to you" }).getAttribute("aria-pressed"), "true");
  await merge.getByRole("button", { name: "Act without asking" }).click();
  await until(async () => ((await pip()).context.rules as Record<string, string>).merge_pr === "allow" || undefined, "the rule to save");
  await page.reload();
  assert.equal(await page.getByRole("group", { name: "Merge a pull request" }).getByRole("button", { name: "Act without asking" }).getAttribute("aria-pressed"), "true");
  assert.match(await page.locator('[data-safety="change_password"]').innerText(), /Change a password\s*Always yours to do/);
  assert.match(await page.locator('[data-safety="delete_permanently"]').innerText(), /Always asks first/);
  assert.equal(await page.locator('[data-rule="change_password"]').count(), 0, "built-in safety has no rule to set");
  assert.equal((await page.request.put(`${web}/api/dots/sam-dot/rules`, { data: { action: "change_password", level: "allow" } })).status(), 400);
  await shoot(page, "rules");
  console.log("6. Rules: merging set to act without asking; built-in safety is locked");

  // 7. Pause and resume.
  await page.getByRole("link", { name: "Activity", exact: true }).click();
  await page.getByRole("button", { name: "Pause Pip" }).click();
  await page.getByRole("button", { name: "Resume Pip" }).waitFor();
  assert.equal((await pip()).context.paused, true);
  await page.getByRole("link", { name: "Pip", exact: true }).click();
  await page.getByText("Paused, only reads").waitFor();
  await page.getByRole("link", { name: "Activity", exact: true }).click();
  await page.getByRole("button", { name: "Resume Pip" }).click();
  await page.getByRole("button", { name: "Pause Pip" }).waitFor();
  assert.equal((await pip()).context.paused, false);
  console.log("7. he paused Pip and resumed it");

  // 8. Apps.
  await page.getByRole("link", { name: "Apps", exact: true }).click();
  const gmail = page.getByRole("region", { name: "Gmail" });
  await gmail.waitFor();
  const gmailText = await gmail.innerText();
  for (const expected of ["support@example.com", "New mail", "Watching support@example.com", "Send email", "Your rule: ask first"]) assert.ok(gmailText.includes(expected), `Gmail shows ${expected}`);
  const slack = await page.getByRole("region", { name: "Slack" }).innerText();
  for (const expected of ["Your DMs and mentions", "Posts as the bot", "Your messages"]) assert.ok(slack.includes(expected), `Slack shows ${expected}`);
  await shoot(page, "apps");
  console.log("8. Apps: the support mailbox and Slack, with what comes in, what goes out and the playbooks");

  // Home, with a fresh suggestion, for the screenshot.
  await research();
  await page.getByRole("link", { name: "Pip", exact: true }).click();
  await page.getByRole("group", { name: "Suggestion from research" }).waitFor({ timeout: 30_000 });
  await shoot(page, "home");

  // Only whitelisted events, with only their listed fields, reached the browser.
  const allowed: Record<string, ReadonlyArray<string>> = {
    "agent.text_delta": ["text"],
    "agent.tool_use": ["name", "label", "chip"],
    "agent.tool_use_result": ["name", "status"],
    "agent.foundry.approval.requested": ["approvalId", "toolName"],
    "approval.resolved": ["approvalId", "status"],
    "run.started": [], "run.completed": [], "run.failed": [], "run.cancelled": [],
  };
  for (const event of await live()) {
    const { seq: _seq, type, ...fields } = event;
    assert.ok(allowed[type], `unexpected live event ${type}`);
    for (const field of Object.keys(fields)) assert.ok(allowed[type]!.includes(field), `${type} carried ${field}`);
  }
  assert.doesNotMatch(await page.content(), new RegExp(token), "no Foundry token in the page");

  // 9. Ada's records are not found; no session is not allowed; a forged link signs no one in.
  const adaHandOff = (await readFile(join(dataDir, "handoffs.jsonl"), "utf8")).split("\n").filter(Boolean)
    .map((line) => JSON.parse(line) as { id: string; workspaceId?: string }).find((line) => line.workspaceId === "ada");
  assert.ok(adaHandOff, "Ada's dot handed her something");
  const notFound = [
    await page.request.get(`${web}/api/dots/ada-dot/chat`),
    await page.request.post(`${web}/api/dots/ada-dot/chat`, { data: { text: "hi" } }),
    await page.request.put(`${web}/api/dots/ada-dot/rules`, { data: { action: "merge_pr", level: "allow" } }),
    await page.request.post(`${web}/api/dots/ada-dot/pause`, { data: { paused: true } }),
    await page.request.post(`${web}/api/dots/ada-dot/responsibilities`, { data: { job: "x", sources: "y" } }),
    await page.request.get(`${web}/api/dots/ada-dot/activity`),
    await page.request.get(`${web}/api/runs/${adaRun.id}/live`),
    await page.request.post(`${web}/api/runs/${adaDraft.id}/steer`, { data: { text: "stop" } }),
    await page.request.post(`${web}/api/approvals/${adaApproval.id}`, { data: { decision: "approve" } }),
    await page.request.post(`${web}/api/handoffs/${adaHandOff.id}`, { data: {} }),
    await page.request.get(`${web}/api/files?agent=ada-dot&path=${encodeURIComponent("/workspace/x.md")}`),
  ];
  assert.deepEqual(notFound.map((response) => response.status()), notFound.map(() => 404));
  assert.equal((await foundryJson<Array<{ id: string; status: string }>>("/api/approvals")).find((item) => item.id === adaApproval.id)?.status, "pending", "Ada's approval is untouched");
  assert.equal((await fetch(`${web}/api/dots/sam-dot/chat`)).status, 401);
  const forged = await fetch(`${web}/signin?t=${invite.split("t=")[1]!.replace(/^sam/, "ada")}`, { redirect: "manual" });
  assert.equal(forged.headers.get("location"), "/welcome?link=expired");
  assert.equal(forged.headers.get("set-cookie"), null);
  console.log("9. Ada's dot, runs, approval, hand-off and files answer 404 to Sam; no session gets 401; a forged link signs no one in");

  // 10. Signing out.
  await page.getByLabel("Signed in as Sam").click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(`${web}/welcome`);
  await page.goto(`${web}/`);
  assert.equal(new URL(page.url()).pathname, "/welcome");
  console.log("10. he signed out");

  console.log("\nWeb app verified: invite sign-in, a streamed reply, research and its suggestion, an approval, Activity with a hand-off and a redirect, a rule, pause and resume, Apps, workspace checks, sign-out.");
} catch (error) {
  console.error(log.split("\n").slice(-60).join("\n"));
  throw error;
} finally {
  await browser.close();
  unit.kill("SIGTERM");
  await new Promise((done) => unit.exitCode !== null ? done(undefined) : unit.once("exit", done));
  await rm(dataDir, { recursive: true, force: true });
}
