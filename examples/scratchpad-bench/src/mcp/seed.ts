/**
 * A deterministic, cross-linked "engineering org" — the single source of truth
 * every mock service reads from. One PRNG seed ⇒ byte-identical world on every
 * run, so a benchmark result is reproducible and a scenario's expected answer
 * can be computed directly from this data.
 *
 * The world is intentionally cross-referential: a GitHub PR names the Linear
 * issue it closes; a Sentry issue and a PagerDuty incident share a theme; a
 * Slack thread and an email discuss the same launch. That's what makes the
 * multi-service scenarios (and the JOINs the scratchpad arm leans on) real.
 *
 * Scale is tunable via BENCH_SCALE (default 1) to dial context pressure.
 */

// ── deterministic PRNG (mulberry32) ─────────────────────────────────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface World {
  users: User[];
  repos: string[];
  teams: string[];
  projects: string[];
  services: string[];
  themes: Theme[];
  githubPrs: GithubPr[];
  githubIssues: GithubIssue[];
  linearIssues: LinearIssue[];
  jiraIssues: JiraIssue[];
  sentryIssues: SentryIssue[];
  pagerIncidents: PagerIncident[];
  emails: Email[];
  slackChannels: SlackChannel[];
  slackMessages: SlackMessage[];
  notionPages: NotionPage[];
  calendarEvents: CalendarEvent[];
  files: FileEntry[];
  /** Mutable side-effect log for write tools (git-inspectable in transcripts). */
  outbox: OutboxItem[];
}

export interface User { login: string; name: string; email: string; team: string }
export interface Theme { slug: string; title: string; service: string }
export interface GithubPr {
  number: number; repo: string; title: string; author: string;
  state: "open" | "merged" | "closed"; additions: number; deletions: number;
  created_at: string; merged_at: string | null; base: string; closes_linear: string | null; body: string;
}
export interface GithubIssue {
  number: number; repo: string; title: string; author: string;
  state: "open" | "closed"; labels: string; comments: number; created_at: string;
}
export interface LinearIssue {
  id: string; title: string; assignee: string; state: "backlog" | "todo" | "in_progress" | "in_review" | "done" | "canceled";
  priority: number; estimate: number; team: string; project: string; created_at: string; updated_at: string;
}
export interface JiraIssue {
  key: string; summary: string; assignee: string; status: "To Do" | "In Progress" | "In Review" | "Done";
  priority: "Low" | "Medium" | "High" | "Critical"; sprint: string; story_points: number; created_at: string;
}
export interface SentryIssue {
  id: string; title: string; culprit: string; level: "error" | "warning" | "fatal";
  count: number; users_affected: number; status: "unresolved" | "resolved" | "ignored";
  project: string; first_seen: string; last_seen: string;
}
export interface PagerIncident {
  id: string; title: string; service: string; status: "triggered" | "acknowledged" | "resolved";
  urgency: "high" | "low"; assignee: string; created_at: string;
}
export interface Email {
  id: string; from: string; to: string; subject: string; snippet: string;
  date: string; unread: boolean; labels: string;
}
export interface SlackChannel { id: string; name: string; topic: string; members: number }
export interface SlackMessage { id: string; channel: string; user: string; text: string; ts: string; reactions: number }
export interface NotionPage { id: string; title: string; database: string; author: string; last_edited: string; url: string }
export interface CalendarEvent {
  id: string; title: string; start: string; end: string; organizer: string; attendees: string; location: string;
}
export interface FileEntry { path: string; size: number; modified: string; type: string; lines: number }
export interface OutboxItem { kind: string; at: string; payload: Row }
type Row = Record<string, unknown>;

const FIRST = ["Alice", "Bob", "Carol", "Dave", "Erin", "Frank", "Grace", "Heidi", "Ivan", "Judy", "Mallory", "Niaj"];
const THEME_DEFS: Array<[string, string, string]> = [
  ["checkout-latency", "Checkout latency spikes at peak", "web"],
  ["oauth-migration", "Migrate auth to OAuth2 + PKCE", "api"],
  ["ios18-crash", "Mobile crash on iOS 18 cold start", "mobile"],
  ["billing-webhooks", "Billing webhook retries drop events", "api"],
  ["search-relevance", "Search relevance regression", "web"],
  ["db-failover", "Primary DB failover is slow", "infra"],
  ["image-uploads", "Image uploads time out over 5MB", "web"],
  ["rate-limiter", "Rate limiter false positives", "api"],
  ["onboarding-funnel", "Onboarding funnel drop-off", "web"],
  ["push-notifications", "Push notifications not delivered", "mobile"],
  ["csv-export", "CSV export truncates large accounts", "web"],
  ["sso-provisioning", "SSO SCIM provisioning errors", "api"],
];

function iso(dayOffset: number): string {
  // Anchor to a fixed epoch so dates are deterministic (no Date.now()).
  const base = Date.UTC(2026, 5, 1); // 2026-06-01
  return new Date(base + dayOffset * 86400000).toISOString();
}

export function buildWorld(seed = 1337, scale = Number(process.env.BENCH_SCALE ?? 1)): World {
  const rnd = mulberry32(seed);
  const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const chance = (p: number) => rnd() < p;
  const n = (base: number) => Math.max(1, Math.round(base * scale));

  const teams = ["web", "api", "mobile", "infra"];
  const repos = ["acme/web", "acme/api", "acme/mobile", "acme/infra"];
  const projects = ["Q3 Reliability", "Growth", "Platform", "Payments"];
  const services = ["web-frontend", "api-gateway", "billing", "mobile-bff", "search"];
  const used = new Set<string>();
  const users: User[] = [];
  for (let i = 0; i < 12; i++) {
    const first = FIRST[i];
    let login = first.toLowerCase();
    while (used.has(login)) login += i;
    used.add(login);
    users.push({ login, name: `${first} ${String.fromCharCode(65 + i)}.`, email: `${login}@acme.io`, team: teams[i % teams.length] });
  }
  const themes: Theme[] = THEME_DEFS.map(([slug, title, service]) => ({ slug, title, service }));
  const themeTitle = () => pick(themes);

  // ── Linear issues (the backbone; other services reference these) ──────────
  const linearIssues: LinearIssue[] = [];
  const states: LinearIssue["state"][] = ["backlog", "todo", "in_progress", "in_review", "done", "canceled"];
  for (let i = 0; i < n(60); i++) {
    const t = themeTitle();
    const created = -int(1, 120);
    linearIssues.push({
      id: `ENG-${100 + i}`,
      title: `${t.title}${chance(0.4) ? " — follow-up" : ""}`,
      assignee: pick(users).login,
      state: pick(states),
      priority: int(0, 4),
      estimate: pick([1, 2, 3, 5, 8]),
      team: pick(teams),
      project: pick(projects),
      created_at: iso(created),
      updated_at: iso(created + int(0, 20)),
    });
  }

  // ── GitHub PRs (some close a Linear issue) ────────────────────────────────
  const githubPrs: GithubPr[] = [];
  for (let i = 0; i < n(40); i++) {
    const t = themeTitle();
    const state = pick(["open", "merged", "closed", "merged", "open"]) as GithubPr["state"];
    const created = -int(1, 90);
    const closes = chance(0.5) ? pick(linearIssues).id : null;
    githubPrs.push({
      number: 1000 + i,
      repo: pick(repos),
      title: `${t.title}: ${pick(["fix", "refactor", "add test for", "guard against", "instrument"])} ${t.slug}`,
      author: pick(users).login,
      state,
      additions: int(3, 800),
      deletions: int(0, 400),
      created_at: iso(created),
      merged_at: state === "merged" ? iso(created + int(1, 10)) : null,
      base: "main",
      closes_linear: closes,
      body: `This change addresses ${t.title.toLowerCase()}.${closes ? ` Closes ${closes}.` : ""}`,
    });
  }

  const githubIssues: GithubIssue[] = [];
  for (let i = 0; i < n(30); i++) {
    const t = themeTitle();
    githubIssues.push({
      number: 2000 + i,
      repo: pick(repos),
      title: `${t.title}`,
      author: pick(users).login,
      state: pick(["open", "open", "closed"]) as GithubIssue["state"],
      labels: [pick(["bug", "enhancement", "chore"]), chance(0.5) ? "p1" : "p2"].join(","),
      comments: int(0, 25),
      created_at: iso(-int(1, 100)),
    });
  }

  // ── Jira (a second tracker some teams use) ────────────────────────────────
  const jiraIssues: JiraIssue[] = [];
  const jstatus: JiraIssue["status"][] = ["To Do", "In Progress", "In Review", "Done"];
  for (let i = 0; i < n(35); i++) {
    const t = themeTitle();
    jiraIssues.push({
      key: `OPS-${200 + i}`,
      summary: t.title,
      assignee: pick(users).login,
      status: pick(jstatus),
      priority: pick(["Low", "Medium", "High", "Critical"]) as JiraIssue["priority"],
      sprint: `Sprint ${int(20, 26)}`,
      story_points: pick([1, 2, 3, 5, 8, 13]),
      created_at: iso(-int(1, 80)),
    });
  }

  // ── Sentry ────────────────────────────────────────────────────────────────
  const sentryIssues: SentryIssue[] = [];
  for (let i = 0; i < n(35); i++) {
    const t = themeTitle();
    const last = -int(0, 14);
    sentryIssues.push({
      id: `SENTRY-${3000 + i}`,
      title: `${pick(["TypeError", "TimeoutError", "NullPointer", "OOMKilled", "5xx"])}: ${t.title}`,
      culprit: `${t.service}/${t.slug}.ts`,
      level: pick(["error", "error", "warning", "fatal"]) as SentryIssue["level"],
      count: int(5, 5000),
      users_affected: int(1, 900),
      status: pick(["unresolved", "unresolved", "resolved", "ignored"]) as SentryIssue["status"],
      project: pick(services),
      first_seen: iso(-int(15, 60)),
      last_seen: iso(last),
    });
  }

  // ── PagerDuty (high-urgency incidents share themes with Sentry) ───────────
  const pagerIncidents: PagerIncident[] = [];
  for (let i = 0; i < n(20); i++) {
    const t = themeTitle();
    pagerIncidents.push({
      id: `PD-${400 + i}`,
      title: `${t.title} — page`,
      service: pick(services),
      status: pick(["triggered", "acknowledged", "resolved", "resolved"]) as PagerIncident["status"],
      urgency: pick(["high", "high", "low"]) as PagerIncident["urgency"],
      assignee: pick(users).login,
      created_at: iso(-int(0, 20)),
    });
  }

  // ── Email ─────────────────────────────────────────────────────────────────
  const emails: Email[] = [];
  for (let i = 0; i < n(50); i++) {
    const t = themeTitle();
    const from = pick(users);
    emails.push({
      id: `msg-${5000 + i}`,
      from: from.email,
      to: pick(users).email,
      subject: pick(["Re: ", "FYI: ", "[Action needed] ", ""]) + t.title,
      snippet: `About ${t.title.toLowerCase()} — ${pick(["can you review", "shipping today", "blocked on infra", "customer escalation", "postmortem draft"])}.`,
      date: iso(-int(0, 30)),
      unread: chance(0.4),
      labels: pick(["inbox", "inbox,important", "inbox,updates"]),
    });
  }

  // ── Slack ──────────────────────────────────────────────────────────────────
  const slackChannels: SlackChannel[] = [
    { id: "C01", name: "eng-web", topic: "web team", members: 24 },
    { id: "C02", name: "eng-api", topic: "api team", members: 19 },
    { id: "C03", name: "incidents", topic: "live incidents", members: 60 },
    { id: "C04", name: "releases", topic: "release coordination", members: 41 },
    { id: "C05", name: "mobile", topic: "mobile team", members: 15 },
  ];
  const slackMessages: SlackMessage[] = [];
  for (let i = 0; i < n(80); i++) {
    const t = themeTitle();
    slackMessages.push({
      id: `${6000 + i}`,
      channel: pick(slackChannels).name,
      user: pick(users).login,
      text: `${pick(["seeing", "fixed", "still investigating", "rolled back", "deployed fix for"])} ${t.title.toLowerCase()}`,
      ts: iso(-int(0, 21)),
      reactions: int(0, 12),
    });
  }

  // ── Notion ─────────────────────────────────────────────────────────────────
  const notionPages: NotionPage[] = [];
  for (let i = 0; i < n(25); i++) {
    const t = themeTitle();
    notionPages.push({
      id: `nt-${7000 + i}`,
      title: pick(["Postmortem: ", "RFC: ", "Runbook: ", "Spec: "]) + t.title,
      database: pick(["Docs", "Postmortems", "RFCs"]),
      author: pick(users).login,
      last_edited: iso(-int(0, 40)),
      url: `https://notion.so/acme/${t.slug}-${i}`,
    });
  }

  // ── Calendar ────────────────────────────────────────────────────────────────
  const calendarEvents: CalendarEvent[] = [];
  for (let i = 0; i < n(30); i++) {
    const t = themeTitle();
    const day = int(0, 14);
    calendarEvents.push({
      id: `cal-${8000 + i}`,
      title: pick(["Standup", "Incident review: ", "1:1", "Sprint planning", "Design review: "]) + (chance(0.5) ? t.title : ""),
      start: iso(day) ,
      end: iso(day),
      organizer: pick(users).login,
      attendees: [pick(users).login, pick(users).login, pick(users).login].join(","),
      location: pick(["Zoom", "Meet", "Room A", "Room B"]),
    });
  }

  // ── Filesystem ──────────────────────────────────────────────────────────────
  const files: FileEntry[] = [];
  const dirs = ["src", "src/api", "src/web", "src/mobile", "tests", "infra", "docs"];
  for (let i = 0; i < n(50); i++) {
    const t = themeTitle();
    const dir = pick(dirs);
    files.push({
      path: `${dir}/${t.slug}${pick([".ts", ".tsx", ".test.ts", ".md", ".yaml"])}`,
      size: int(200, 40000),
      modified: iso(-int(0, 60)),
      type: pick(["file", "file", "file"]),
      lines: int(10, 1200),
    });
  }

  return {
    users, repos, teams, projects, services, themes,
    githubPrs, githubIssues, linearIssues, jiraIssues, sentryIssues, pagerIncidents,
    emails, slackChannels, slackMessages, notionPages, calendarEvents, files,
    outbox: [],
  };
}
