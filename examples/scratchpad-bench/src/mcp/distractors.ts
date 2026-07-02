/**
 * The distractor fleet — what production actually looks like.
 *
 * A real agent platform (Proxima-style) connects DOZENS of MCP servers, each
 * shipping 8–16 tools with verbose descriptions and optional knobs (limit,
 * cursor, sort_by, dry_run…), and for any given task ~95% of that surface is
 * noise. This module generates that fleet deterministically: ~30 plausible
 * SaaS/infra domains, each with seeded record collections, production-flavored
 * tool sets, and entity tables — none of which any benchmark task needs.
 *
 * Ids are namespaced (`str_ch_1041`, `dd_mon_17`) so distractor data can never
 * satisfy a grader by accident. Write-verb handlers record to the outbox under
 * `${ns}.${tool}` kinds no verifier filters on.
 */
import { z } from "zod";
import type { Row, ServerSpec } from "./spec";
import type { World } from "./seed";

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

interface CollectionDef {
  /** plural table/tool noun, e.g. "charges" */
  name: string;
  singular: string;
  idPrefix: string;
  /** extra string columns beyond id/name/status/created_at */
  fields: string[];
  statuses: string[];
}

interface DomainDef {
  ns: string;
  title: string;
  blurb: string;
  collections: CollectionDef[];
  /** domain-flavored action verbs (write tools) */
  verbs: Array<{ name: string; desc: string; args: string[] }>;
}

const col = (name: string, singular: string, idPrefix: string, fields: string[], statuses: string[]): CollectionDef => ({
  name,
  singular,
  idPrefix,
  fields,
  statuses,
});

export const DISTRACTOR_DOMAINS: DomainDef[] = [
  { ns: "stripe", title: "Stripe", blurb: "payments", collections: [col("charges", "charge", "str_ch", ["amount", "currency", "customer"], ["succeeded", "pending", "failed"]), col("payment_disputes", "dispute", "str_dp", ["amount", "reason"], ["open", "won", "lost"])], verbs: [{ name: "refund_charge", desc: "Issue a full or partial refund for a charge. Refunds settle to the original payment method in 5-10 business days.", args: ["charge_id", "amount"] }, { name: "capture_charge", desc: "Capture a previously authorized charge. Uncaptured charges expire after 7 days.", args: ["charge_id"] }] },
  { ns: "datadog", title: "Datadog", blurb: "observability", collections: [col("monitors", "monitor", "dd_mon", ["query", "threshold", "team"], ["ok", "alert", "warn", "no_data"]), col("dashboards", "dashboard", "dd_dash", ["layout", "owner"], ["active", "archived"])], verbs: [{ name: "mute_monitor", desc: "Mute a monitor for a duration. Muted monitors continue to evaluate but do not notify.", args: ["monitor_id", "duration_minutes"] }, { name: "trigger_synthetic_test", desc: "Run a synthetics test immediately rather than waiting for its schedule.", args: ["test_id"] }] },
  { ns: "kubernetes", title: "Kubernetes", blurb: "container orchestration", collections: [col("deployments", "deployment", "k8s_dep", ["namespace", "replicas", "image"], ["available", "progressing", "degraded"]), col("pods", "pod", "k8s_pod", ["node", "namespace", "restarts"], ["running", "pending", "crashloop", "evicted"])], verbs: [{ name: "scale_deployment", desc: "Change the replica count of a deployment. Scaling to zero stops all traffic to the workload.", args: ["deployment_id", "replicas"] }, { name: "rollout_restart", desc: "Perform a rolling restart of a deployment's pods with zero downtime when PodDisruptionBudgets allow.", args: ["deployment_id"] }, { name: "cordon_node", desc: "Mark a node unschedulable so no new pods land on it. Existing pods keep running.", args: ["node_name"] }] },
  { ns: "salesforce", title: "Salesforce", blurb: "CRM", collections: [col("opportunities", "opportunity", "sf_opp", ["account", "stage", "amount"], ["open", "closed_won", "closed_lost"]), col("sf_leads", "lead", "sf_lead", ["company", "source"], ["new", "working", "qualified", "unqualified"])], verbs: [{ name: "convert_lead", desc: "Convert a qualified lead into an account, contact, and optionally an opportunity in one operation.", args: ["lead_id"] }] },
  { ns: "zendesk", title: "Zendesk", blurb: "support", collections: [col("tickets", "ticket", "zd_tk", ["requester", "priority", "group"], ["new", "open", "pending", "solved", "closed"]), col("macros", "macro", "zd_mac", ["actions"], ["active", "inactive"])], verbs: [{ name: "merge_tickets", desc: "Merge one or more tickets into a target ticket. Merged tickets are closed with a link back to the target.", args: ["source_ids", "target_id"] }] },
  { ns: "twilio", title: "Twilio", blurb: "messaging", collections: [col("sms_messages", "message", "tw_sms", ["from_number", "to_number", "segments"], ["queued", "sent", "delivered", "failed"]), col("phone_numbers", "number", "tw_num", ["capabilities", "region"], ["active", "released"])], verbs: [{ name: "send_sms", desc: "Send an SMS. Long bodies are split into segments billed individually; delivery receipts arrive asynchronously.", args: ["to_number", "body"] }] },
  { ns: "figma", title: "Figma", blurb: "design", collections: [col("design_files", "file", "fig_f", ["project", "editor"], ["draft", "in_review", "ready"]), col("components", "component", "fig_c", ["file", "variants"], ["published", "unpublished"])], verbs: [{ name: "export_frames", desc: "Export the selected frames of a file as PNG/SVG at chosen scale factors.", args: ["file_id", "format"] }] },
  { ns: "gdrive", title: "Google Drive", blurb: "documents", collections: [col("drive_files", "file", "gd_f", ["folder", "owner", "mime_type"], ["active", "trashed"]), col("permissions", "permission", "gd_p", ["file", "grantee", "role"], ["active", "expired"])], verbs: [{ name: "share_file", desc: "Grant a user or group access to a file at reader/commenter/writer role. Sends a notification email unless suppressed.", args: ["file_id", "grantee", "role"] }] },
  { ns: "confluence", title: "Confluence", blurb: "wiki", collections: [col("wiki_pages", "page", "cf_pg", ["space", "author", "version"], ["current", "draft", "archived"]), col("spaces", "space", "cf_sp", ["lead"], ["active", "readonly"])], verbs: [{ name: "publish_draft", desc: "Publish a draft page, making it the current version and notifying space watchers.", args: ["page_id"] }] },
  { ns: "circleci", title: "CircleCI", blurb: "CI", collections: [col("pipelines", "pipeline", "cci_pl", ["project", "branch", "trigger"], ["success", "failed", "running", "canceled"]), col("workflows", "workflow", "cci_wf", ["pipeline", "duration_s"], ["success", "failed", "running"])], verbs: [{ name: "rerun_workflow", desc: "Re-run a workflow, optionally from the failed job onward to reuse successful artifacts.", args: ["workflow_id", "from_failed"] }] },
  { ns: "snowflake", title: "Snowflake", blurb: "warehouse", collections: [col("warehouses", "warehouse", "sn_wh", ["size", "auto_suspend_s"], ["started", "suspended"]), col("snowflake_queries", "query", "sn_q", ["warehouse", "duration_ms", "user"], ["success", "failed", "queued"])], verbs: [{ name: "resume_warehouse", desc: "Resume a suspended warehouse. Billing begins immediately at the warehouse's size tier.", args: ["warehouse_id"] }] },
  { ns: "segment", title: "Segment", blurb: "CDP", collections: [col("segment_sources", "source", "sg_src", ["kind", "write_keys"], ["enabled", "disabled"]), col("destinations", "destination", "sg_dst", ["source", "kind"], ["connected", "errored", "disabled"])], verbs: [{ name: "replay_events", desc: "Replay historical events from a source to a destination over a time range. Large replays are rate-limited.", args: ["source_id", "destination_id"] }] },
  { ns: "auth0", title: "Auth0", blurb: "identity", collections: [col("auth_clients", "client", "a0_cl", ["type", "callbacks"], ["active", "disabled"]), col("auth_users", "user", "a0_us", ["email_domain", "connection", "logins"], ["active", "blocked"])], verbs: [{ name: "rotate_client_secret", desc: "Rotate a client's secret immediately. All deployed instances must be updated or authentication will fail.", args: ["client_id"] }] },
  { ns: "grafana", title: "Grafana", blurb: "dashboards", collections: [col("grafana_alerts", "alert", "gf_al", ["rule", "folder"], ["normal", "pending", "firing"]), col("panels", "panel", "gf_pn", ["dashboard", "kind"], ["ok", "broken_query"])], verbs: [{ name: "silence_alert", desc: "Create a silence matching an alert's labels for a duration.", args: ["alert_id", "duration_minutes"] }] },
  { ns: "vercel", title: "Vercel", blurb: "hosting", collections: [col("vercel_deployments", "deployment", "vc_dep", ["project", "branch", "region"], ["ready", "building", "error", "canceled"]), col("edge_configs", "config", "vc_cfg", ["items"], ["active"])], verbs: [{ name: "promote_deployment", desc: "Promote a preview deployment to production, updating all production aliases atomically.", args: ["deployment_id"] }, { name: "rollback_deployment", desc: "Instantly point production back at a previous deployment.", args: ["deployment_id"] }] },
  { ns: "npmjs", title: "npm Registry", blurb: "packages", collections: [col("packages", "package", "npm_pk", ["scope", "latest", "weekly_downloads"], ["published", "deprecated"]), col("package_tokens", "token", "npm_tok", ["scope_access"], ["active", "revoked"])], verbs: [{ name: "deprecate_version", desc: "Mark a published version deprecated with a message shown on install.", args: ["package_id", "version", "message"] }] },
  { ns: "dockerhub", title: "Docker Hub", blurb: "images", collections: [col("image_repos", "repository", "dh_rp", ["visibility", "pulls"], ["active", "archived"]), col("image_tags", "tag", "dh_tg", ["repository", "digest", "size_mb"], ["current", "stale"])], verbs: [{ name: "trigger_build", desc: "Queue an automated build for a repository from its linked source.", args: ["repository_id"] }] },
  { ns: "terraform", title: "Terraform Cloud", blurb: "IaC", collections: [col("tf_workspaces", "workspace", "tf_ws", ["org", "terraform_version"], ["applied", "planning", "errored", "locked"]), col("tf_runs", "run", "tf_run", ["workspace", "changes"], ["applied", "planned", "discarded", "errored"])], verbs: [{ name: "queue_plan", desc: "Queue a speculative or applyable plan on a workspace against latest configuration.", args: ["workspace_id"] }] },
  { ns: "hubspot", title: "HubSpot", blurb: "marketing", collections: [col("contacts", "contact", "hs_ct", ["lifecycle", "owner", "source"], ["subscriber", "lead", "customer"]), col("email_campaigns", "campaign", "hs_cp", ["audience", "open_rate"], ["draft", "scheduled", "sent"])], verbs: [{ name: "enroll_in_sequence", desc: "Enroll a contact into an outreach sequence honoring send windows and unenrollment triggers.", args: ["contact_id", "sequence_id"] }] },
  { ns: "intercom", title: "Intercom", blurb: "messaging", collections: [col("conversations", "conversation", "ic_cv", ["assignee", "channel"], ["open", "snoozed", "closed"]), col("intercom_articles", "article", "ic_ar", ["collection", "views"], ["published", "draft"])], verbs: [{ name: "assign_conversation", desc: "Assign a conversation to a teammate or team inbox.", args: ["conversation_id", "assignee"] }] },
  { ns: "amplitude", title: "Amplitude", blurb: "analytics", collections: [col("cohorts", "cohort", "am_ch", ["definition", "size"], ["computed", "computing", "archived"]), col("charts", "chart", "am_crt", ["kind", "owner"], ["active", "archived"])], verbs: [{ name: "export_cohort", desc: "Export a computed cohort's user ids to a connected destination.", args: ["cohort_id", "destination"] }] },
  { ns: "launchdarkly", title: "LaunchDarkly", blurb: "feature flags", collections: [col("feature_flags", "flag", "ld_fl", ["project", "kind", "rollout_pct"], ["on", "off", "archived"]), col("flag_environments", "environment", "ld_env", ["project"], ["production", "staging", "test"])], verbs: [{ name: "toggle_flag", desc: "Turn a flag on or off in one environment. Changes propagate to connected SDKs within seconds.", args: ["flag_id", "environment", "on"] }] },
  { ns: "okta", title: "Okta", blurb: "SSO", collections: [col("okta_apps", "app", "ok_ap", ["sign_on_mode"], ["active", "inactive"]), col("okta_groups", "group", "ok_gr", ["members", "rules"], ["active"])], verbs: [{ name: "deactivate_user", desc: "Deactivate a user across all assigned applications. Sessions are revoked within minutes.", args: ["user_id"] }] },
  { ns: "workday", title: "Workday", blurb: "HR", collections: [col("workers", "worker", "wd_wk", ["org", "location", "manager"], ["active", "on_leave", "terminated"]), col("time_off_requests", "request", "wd_to", ["worker", "days"], ["submitted", "approved", "denied"])], verbs: [{ name: "approve_time_off", desc: "Approve a submitted time-off request and update the worker's balance.", args: ["request_id"] }] },
  { ns: "greenhouse", title: "Greenhouse", blurb: "recruiting", collections: [col("candidates", "candidate", "gh_cd", ["role", "stage", "recruiter"], ["active", "hired", "rejected"]), col("interviews", "interview", "gh_iv", ["candidate", "panel"], ["scheduled", "complete", "canceled"])], verbs: [{ name: "advance_candidate", desc: "Move a candidate to the next stage of their job's interview plan.", args: ["candidate_id"] }] },
  { ns: "netsuite", title: "NetSuite", blurb: "ERP", collections: [col("invoices", "invoice", "ns_inv", ["customer", "amount", "terms"], ["open", "paid", "overdue", "void"]), col("purchase_orders", "order", "ns_po", ["vendor", "amount"], ["pending", "approved", "received", "closed"])], verbs: [{ name: "void_invoice", desc: "Void an open invoice. GL impact is reversed in the posting period of the void.", args: ["invoice_id", "reason"] }] },
  { ns: "tableau", title: "Tableau", blurb: "BI", collections: [col("workbooks", "workbook", "tb_wb", ["project_area", "owner", "views"], ["published", "stale"]), col("extracts", "extract", "tb_ex", ["workbook", "rows"], ["fresh", "refreshing", "failed"])], verbs: [{ name: "refresh_extract", desc: "Kick off a full refresh of a workbook's extract. Queries the live datasource at warehouse cost.", args: ["extract_id"] }] },
  { ns: "elastic", title: "Elasticsearch", blurb: "search infra", collections: [col("indices", "index", "es_ix", ["shards", "size_gb", "ilm_phase"], ["green", "yellow", "red"]), col("ingest_pipelines", "pipeline", "es_pl", ["processors"], ["active", "failing"])], verbs: [{ name: "force_merge", desc: "Force-merge an index's segments to reduce search overhead. IO-intensive; run off-peak.", args: ["index_id"] }] },
  { ns: "rabbitmq", title: "RabbitMQ", blurb: "queues", collections: [col("queues", "queue", "rmq_q", ["vhost", "depth", "consumers"], ["running", "idle", "flow"]), col("exchanges", "exchange", "rmq_ex", ["kind", "bindings"], ["active"])], verbs: [{ name: "purge_queue", desc: "Discard all messages currently in a queue. Unacked deliveries are not purged.", args: ["queue_id"] }] },
  { ns: "redis", title: "Redis Cloud", blurb: "cache", collections: [col("redis_databases", "database", "rd_db", ["memory_mb", "eviction", "ops_sec"], ["active", "pending", "error"]), col("redis_alerts", "alert", "rd_al", ["database", "metric"], ["ok", "triggered"])], verbs: [{ name: "flush_database", desc: "Delete every key in a database. Irreversible; requires the confirm flag.", args: ["database_id", "confirm"] }] },
  { ns: "cloudflare", title: "Cloudflare", blurb: "edge", collections: [col("zones", "zone", "cf_zn", ["plan", "nameservers"], ["active", "pending", "paused"]), col("waf_rules", "rule", "cf_wf", ["zone", "expression"], ["enabled", "disabled"])], verbs: [{ name: "purge_cache", desc: "Purge cached content for a zone, either everything or by URL list.", args: ["zone_id", "purge_everything"] }] },
];

/** Build N distractor servers (deterministic; default: all). */
export function distractorServers(world: World, seed = 4242, count = DISTRACTOR_DOMAINS.length): ServerSpec[] {
  const rnd = mulberry32(seed);
  const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
  const WORDS = ["atlas", "boron", "cedar", "delta", "ember", "fjord", "gale", "harbor", "iris", "juniper", "krill", "lumen", "mesa", "nimbus", "onyx", "prairie"];

  return DISTRACTOR_DOMAINS.slice(0, count).map((d) => {
    // seeded records per collection
    const data = new Map<string, Row[]>();
    for (const c of d.collections) {
      const rows: Row[] = [];
      const n = int(6, 14);
      for (let i = 0; i < n; i++) {
        const row: Row = {
          id: `${c.idPrefix}_${1000 + i}`,
          name: `${pick(WORDS)}-${pick(WORDS)}`,
          status: pick(c.statuses),
          created_at: new Date(int(1, 400) * 86400000).toISOString(),
        };
        for (const f of c.fields) {
          row[f] = /amount|replicas|restarts|duration|size|pulls|downloads|views|members|days|depth|consumers|ops|memory|rows|segments|logins|threshold|open_rate|rollout/.test(f)
            ? int(1, 5000)
            : `${pick(WORDS)}-${int(1, 99)}`;
        }
        rows.push(row);
      }
      data.set(c.name, rows);
    }

    const tools: ServerSpec["tools"] = [];
    for (const c of d.collections) {
      tools.push({
        name: `list_${c.name}`,
        description: `List ${c.name} in the connected ${d.title} account. Supports pagination via limit/cursor and server-side filtering by status. Results are ordered by creation time descending unless sort_by is provided. Large accounts should page rather than raising limit.`,
        readOnly: true,
        input: { status: z.string().optional(), limit: z.number().optional(), cursor: z.string().optional(), sort_by: z.string().optional(), order: z.enum(["asc", "desc"]).optional() },
        handler: (a) => {
          const rows = data.get(c.name)!.filter((r) => !a.status || r.status === a.status);
          return rows.slice(0, Number(a.limit ?? 50));
        },
      });
      tools.push({
        name: `get_${c.singular}`,
        description: `Fetch a single ${c.singular} by id, including fields not present in list responses. Returns a not_found error for ids outside this account.`,
        readOnly: true,
        input: { id: z.string(), fields: z.array(z.string()).optional() },
        handler: (a) => data.get(c.name)!.find((r) => r.id === a.id) ?? { error: "not_found" },
      });
      tools.push({
        name: `search_${c.name}`,
        description: `Full-text search across ${c.name} by name and metadata. Query syntax supports quoted phrases and field:value terms. Search indexes update within one minute of writes.`,
        readOnly: true,
        input: { query: z.string(), limit: z.number().optional() },
        handler: (a) => data.get(c.name)!.filter((r) => String(r.name).includes(String(a.query))).slice(0, Number(a.limit ?? 25)),
      });
      tools.push({
        name: `create_${c.singular}`,
        description: `Create a new ${c.singular} in ${d.title}. Required fields vary by account configuration; omitted optional fields inherit account defaults. Returns the created record with its assigned id.`,
        readOnly: false,
        input: { name: z.string(), ...(Object.fromEntries(c.fields.map((f) => [f, z.string().optional()])) as z.ZodRawShape) },
        handler: (a) => {
          world.outbox.push({ kind: `${d.ns}.create_${c.singular}`, at: new Date(0).toISOString(), payload: a });
          return { id: `${c.idPrefix}_new`, ...a };
        },
      });
      tools.push({
        name: `update_${c.singular}`,
        description: `Update mutable fields of a ${c.singular}. Immutable fields are ignored with a warning; concurrent updates follow last-write-wins.`,
        readOnly: false,
        input: { id: z.string(), name: z.string().optional(), status: z.string().optional() },
        handler: (a) => {
          world.outbox.push({ kind: `${d.ns}.update_${c.singular}`, at: new Date(0).toISOString(), payload: a });
          return { id: a.id, updated: true };
        },
      });
    }
    for (const v of d.verbs) {
      tools.push({
        name: v.name,
        description: `${v.desc} This operation is account-scoped and audited; use dry_run to preview effects where supported.`,
        readOnly: false,
        input: { ...(Object.fromEntries(v.args.map((f) => [f, z.string()])) as z.ZodRawShape), dry_run: z.boolean().optional() },
        handler: (a) => {
          world.outbox.push({ kind: `${d.ns}.${v.name}`, at: new Date(0).toISOString(), payload: a });
          return { ok: true, ...a };
        },
      });
    }

    return {
      namespace: d.ns,
      title: d.title,
      tools,
      entities: d.collections.map((c) => ({
        table: `${d.ns}_${c.name}`,
        description: `${d.title} ${c.name} (${d.blurb}).`,
        volatility: "stable" as const,
        columns: [
          { name: "id", type: "text" },
          { name: "name", type: "text" },
          { name: "status", type: "text", description: c.statuses.join(" | ") },
          { name: "created_at", type: "timestamptz" },
          ...c.fields.map((f) => ({ name: f, type: /amount|replicas|restarts|duration|size|pulls|downloads|views|members|days|depth|consumers|ops|memory|rows|segments|logins|threshold|open_rate|rollout/.test(f) ? "bigint" : "text" })),
        ],
        select: { tool: `list_${c.name}`, args: (b) => ({ ...(b.has("status") && b.all("status").length === 1 && { status: b.one("status") }) }) },
      })),
    };
  });
}
