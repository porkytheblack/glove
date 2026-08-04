/**
 * Scripted conversations and what counts as getting them right.
 *
 * Each scenario is a fixed sequence of user turns. The user never adapts, so
 * the only thing varying across a row of the matrix is the model — which is
 * the whole point. It also means a scenario can be written to land on exactly
 * the behaviour under test rather than hoping it comes up.
 */
import { evaluateForm } from "glove-memory/forms";
import type { CompiledForm, FormAdapter, FormInstance } from "glove-memory/forms";
import type { RunTranscript, ToolEvent } from "./agent";

export interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface GradeContext {
  compiled: CompiledForm<any>;
  adapter: FormAdapter;
  subject: string;
  transcript: RunTranscript;
}

export interface Scenario {
  name: string;
  /** One line on what this scenario is actually probing. */
  probes: string;
  userTurns: string[];
  grade(ctx: GradeContext): Promise<Check[]>;
}

// ─── Grading helpers ──────────────────────────────────────────────────────

/**
 * Whatever instance the conversation ended on — including one the model
 * created by calling `start` again, which is exactly the failure we want
 * visible rather than papered over.
 */
async function finalInstance(ctx: GradeContext): Promise<FormInstance | null> {
  const all = await ctx.adapter.findInstances({ subject: ctx.subject, limit: 20 });
  if (all.length === 0) return null;
  return [...all].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

async function state(ctx: GradeContext) {
  const instance = await finalInstance(ctx);
  if (!instance) return null;
  return { instance, ev: evaluateForm(ctx.compiled, instance) };
}

function eq(name: string, actual: unknown, expected: unknown): Check {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  return {
    name,
    ok,
    detail: ok ? undefined : `got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`,
  };
}

/** Every value the straightforward scenarios are supposed to end up with. */
function valueChecks(
  values: Record<string, unknown>,
  expected: Record<string, unknown>,
): Check[] {
  return Object.entries(expected).map(([k, v]) => eq(k, values[k], v));
}

function writeEvents(events: ToolEvent[]): ToolEvent[] {
  return events.filter(
    (e) =>
      e.name === "glove_form_fill" ||
      e.name === "glove_form_start" ||
      e.name === "glove_form_revise",
  );
}

/** Field ids supplied by a single write call. */
function fieldsIn(e: ToolEvent): string[] {
  if (e.name === "glove_form_revise") return e.args?.field ? [e.args.field] : [];
  return Object.keys(e.args?.values ?? {});
}

function assistantAt(ctx: GradeContext, turn: number): string {
  return (ctx.transcript.turns.find((t) => t.turn === turn)?.assistant ?? "").toLowerCase();
}

function mentionsAny(text: string, needles: string[]): string[] {
  return needles.filter((n) => text.includes(n));
}

const CLAIMANT = {
  fullName: "Ada Okafor",
  staffId: "FN-4471",
  email: "ada.okafor@example.com",
};

const APPROVAL = {
  costCentre: "OPS-220",
  managerEmail: "priya.nayar@example.com",
  receiptsAttached: true,
};

// ─── Scenarios ────────────────────────────────────────────────────────────

export const SCENARIOS: Scenario[] = [
  {
    name: "straight-through",
    probes: "Baseline. Cooperative user, in order — does the plain path work at all?",
    userTurns: [
      "Hi — I need to claim back my travel from last week.",
      "Ada Okafor, staff id FN-4471, ada.okafor@example.com",
      "I went to Manchester for a client visit, out on 2026-07-13 and back on 2026-07-15.",
      "Drove my own car, 240 miles round trip, and the total came to 132.50.",
      "Cost centre is OPS-220, my manager is priya.nayar@example.com, and yes I've got the receipts.",
    ],
    async grade(ctx) {
      const s = await state(ctx);
      if (!s) return [{ name: "instance exists", ok: false }];
      const checks = valueChecks(s.ev.values as Record<string, unknown>, {
        ...CLAIMANT,
        destination: "Manchester",
        departDate: "2026-07-13",
        returnDate: "2026-07-15",
        purpose: "client-visit",
        mode: "car",
        mileage: 240,
        totalAmount: 132.5,
        ...APPROVAL,
      });
      checks.push({ name: "form complete", ok: s.ev.complete });
      checks.push({
        name: "no invented fields",
        ok: ctx.transcript.behaviour.unknownFieldAttempts === 0,
        detail: `${ctx.transcript.behaviour.unknownFieldAttempts} unknown field ids`,
      });
      return checks;
    },
  },

  {
    name: "front-loaded",
    probes:
      "Writes are never gated (§2) — a first turn carrying four steps' worth of answers should land in one call, not be deferred.",
    userTurns: [
      "I need to claim travel expenses. I'm Ada Okafor, FN-4471, ada.okafor@example.com. " +
        "It was a conference in Leeds, 2026-06-02 out and 2026-06-04 back. I went by rail, " +
        "ticket reference RX88213, total was 410. Cost centre OPS-220, manager " +
        "priya.nayar@example.com, and yes receipts are attached.",
      "That's everything I have.",
    ],
    async grade(ctx) {
      const s = await state(ctx);
      if (!s) return [{ name: "instance exists", ok: false }];
      const writes = writeEvents(ctx.transcript.events);
      const widest = writes.reduce((n, e) => Math.max(n, fieldsIn(e).length), 0);

      const checks = valueChecks(s.ev.values as Record<string, unknown>, {
        ...CLAIMANT,
        destination: "Leeds",
        departDate: "2026-06-02",
        returnDate: "2026-06-04",
        purpose: "conference",
        mode: "rail",
        ticketReference: "RX88213",
        totalAmount: 410,
        ...APPROVAL,
      });
      checks.push({ name: "form complete", ok: s.ev.complete });
      checks.push({
        // The design's claim is that out-of-step answers are accepted on the
        // spot. A model that trickles them one step at a time still finishes,
        // but it has made the user wait for nothing.
        name: "captured in one batch",
        ok: widest >= 8,
        detail: `widest single write was ${widest} fields across ${writes.length} write calls`,
      });
      checks.push({
        name: "mileage left empty",
        ok: s.ev.values.mileage === undefined,
        detail: `mileage = ${JSON.stringify(s.ev.values.mileage)}`,
      });
      return checks;
    },
  },

  {
    name: "held-value",
    probes:
      "§5.1 — a correction orphans an answer into `held` rather than deleting it, and the form still completes without it.",
    userTurns: [
      "Claim for a trip to Bristol. Ada Okafor, FN-4471, ada.okafor@example.com.",
      "Training course, out 2026-05-11, back 2026-05-13. I took the train — ticket reference RX40021, total was 96.",
      // "I've mixed up two trips" casts doubt on every figure from the turn
      // before, so models reasonably dropped the £96 as belonging to the other
      // trip. That confound was measuring reading comprehension, not the
      // held/retracted guarantee this scenario exists for — the total is now
      // pinned explicitly.
      "Sorry, I've mixed up two trips. That was the car, not the train — 360 miles round trip. " +
        "The 96 total is still right.",
      "Cost centre OPS-220, manager priya.nayar@example.com, receipts yes.",
    ],
    async grade(ctx) {
      const s = await state(ctx);
      if (!s) return [{ name: "instance exists", ok: false }];
      const checks = valueChecks(s.ev.values as Record<string, unknown>, {
        ...CLAIMANT,
        destination: "Bristol",
        purpose: "training",
        mode: "car",
        mileage: 360,
        totalAmount: 96,
        ...APPROVAL,
      });
      checks.push({ name: "form complete", ok: s.ev.complete });
      // The whole point: the rail ticket the user gave is still on the record.
      // Two legitimate shapes for that, and the guarantee is the same either
      // way — the answer was not destroyed. Either the correction orphaned it
      // into `held`, or the model retracted it, which appends a revision and
      // leaves the original in the log. Grading only `held` would score the
      // better behaviour as a failure.
      const log = s.instance.entries.ticketReference;
      const inHistory = Boolean(log?.revisions.some((r) => r.value === "RX40021"));
      checks.push({
        name: "orphaned ticket survives on the record",
        ok: s.ev.held.ticketReference === "RX40021" || inHistory,
        detail: `held = ${JSON.stringify(s.ev.held)}, revisions = ${JSON.stringify(
          log?.revisions.map((r) => (r.retracted ? "<retracted>" : r.value)) ?? [],
        )}`,
      });
      checks.push({
        name: "ticket not counted as a live value",
        ok: s.ev.values.ticketReference === undefined,
      });
      return checks;
    },
  },

  {
    name: "bad-staff-id",
    probes:
      "§7 — one bad value in a patch must not reject the rest, and the model should re-ask only the field that failed.",
    userTurns: [
      "Travel claim please. I'm Ada Okafor, staff number 4471, email ada.okafor@example.com.",
      "Ah sorry, it's FN-4471.",
      "Conference in Leeds, 2026-06-02 to 2026-06-04. Rail, ticket RX88213, total 410.",
      "Cost centre OPS-220, manager priya.nayar@example.com, receipts yes.",
    ],
    async grade(ctx) {
      const s = await state(ctx);
      if (!s) return [{ name: "instance exists", ok: false }];

      // Did the same call that carried the bad id also land the good fields?
      const firstTurnWrites = writeEvents(ctx.transcript.events).filter((e) => e.turn === 1);
      const partial = firstTurnWrites.some((e) => {
        const captured: string[] = Array.isArray(e.data?.captured) ? e.data.captured : [];
        return captured.includes("fullName") || captured.includes("email");
      });

      const checks: Check[] = [
        {
          name: "schema rejected the malformed id",
          ok: ctx.transcript.behaviour.rejectedValues > 0,
          detail: `${ctx.transcript.behaviour.rejectedValues} rejected values`,
        },
        {
          name: "rest of the patch still landed",
          ok: partial,
          detail: partial ? undefined : "no field from the first turn was captured",
        },
        eq("staffId", s.ev.values.staffId, "FN-4471"),
        eq("fullName", s.ev.values.fullName, CLAIMANT.fullName),
        eq("email", s.ev.values.email, CLAIMANT.email),
        { name: "form complete", ok: s.ev.complete },
      ];
      return checks;
    },
  },

  {
    name: "what-else",
    probes:
      "Tier 2 — asked what's still coming, does the model answer from the form rather than inventing requirements?",
    userTurns: [
      "I need to file a travel claim. Ada Okafor, FN-4471, ada.okafor@example.com.",
      "Before we go on — what else are you going to need from me?",
      "Right. Conference in Leeds, 2026-06-02 to 2026-06-04. Flew, ticket RX88213, total 410.",
      "Cost centre OPS-220, manager priya.nayar@example.com, receipts yes.",
    ],
    async grade(ctx) {
      const s = await state(ctx);
      if (!s) return [{ name: "instance exists", ok: false }];
      const reply = assistantAt(ctx, 2);
      // Tier 0 already carries the step previews, so a correct answer needs no
      // tool call at all — grading the answer, not the mechanism.
      const named = mentionsAny(reply, [
        "cost centre",
        "cost center",
        "manager",
        "receipt",
        "ticket",
        "destination",
        "date",
        "purpose",
      ]);
      return [
        {
          name: "named what's still coming",
          ok: named.length >= 2,
          detail: `matched: ${named.join(", ") || "nothing"}`,
        },
        {
          name: "no hallucinated tools",
          ok: ctx.transcript.behaviour.hallucinatedTools === 0,
        },
        { name: "form complete", ok: s.ev.complete },
        eq("ticketReference", s.ev.values.ticketReference, "RX88213"),
      ];
    },
  },

  {
    name: "retract",
    probes:
      "Per-field history — a user taking something back should retract it, not blank it, and the withdrawn answer must survive on the record.",
    userTurns: [
      "Travel claim. Ada Okafor, FN-4471, ada.okafor@example.com.",
      "Conference in Leeds, 2026-06-02 to 2026-06-04. Rail, ticket RX88213, total 410.",
      "Actually scrap that ticket reference — I can't find it and I'd rather leave it off.",
      "Cost centre OPS-220, manager priya.nayar@example.com, receipts yes.",
    ],
    async grade(ctx) {
      const s = await state(ctx);
      if (!s) return [{ name: "instance exists", ok: false }];
      const log = s.instance.entries.ticketReference;

      return [
        {
          // The whole point: it is gone from `values` but not from the record.
          name: "ticket no longer in force",
          ok: s.ev.values.ticketReference === undefined,
          detail: `values.ticketReference = ${JSON.stringify(s.ev.values.ticketReference)}`,
        },
        {
          name: "the withdrawn answer survives in history",
          ok: Boolean(log?.revisions.some((r) => r.value === "RX88213")),
          detail: `revisions = ${JSON.stringify(log?.revisions.map((r) => r.value) ?? [])}`,
        },
        {
          // A model that blanks a field instead of retracting leaves an empty
          // string in force — the destructive pattern this scenario exists for.
          name: "not blanked with an empty value",
          ok: !s.ev.fields.get("ticketReference")?.hasEntry
            ? true
            : s.ev.values.ticketReference !== "",
          detail: `in force = ${JSON.stringify(s.ev.fields.get("ticketReference")?.raw)}`,
        },
        { name: "form complete", ok: s.ev.complete },
        eq("totalAmount", s.ev.values.totalAmount, 410),
      ];
    },
  },

  {
    name: "over-cap",
    probes:
      "§3 — a blocking checkpoint rejects. Does the model relay the reason and carry on, or swallow it?",
    userTurns: [
      "Travel claim. Ada Okafor, FN-4471, ada.okafor@example.com.",
      "Client visit to Edinburgh, 2026-04-07 to 2026-04-10. Flew, ticket RX55190, total 980.",
      "Cost centre OPS-220, manager priya.nayar@example.com, receipts yes.",
    ],
    async grade(ctx) {
      const s = await state(ctx);
      if (!s) return [{ name: "instance exists", ok: false }];

      const fired = Object.values(s.instance.dispatches).some(
        (d) => d.hookId === "checkpoint:policy-cap" && d.status === "failed",
      );
      // Whatever the model said after the total landed.
      const after = ctx.transcript.turns
        .filter((t) => t.turn >= 2)
        .map((t) => t.assistant.toLowerCase())
        .join(" ");
      const relayed = mentionsAny(after, [
        "pre-approval",
        "preapproval",
        "pre approval",
        "finance",
        "limit",
        "cap",
        "750",
        "approval",
      ]);

      return [
        { name: "checkpoint fired and failed", ok: fired },
        {
          name: "relayed the blocker to the user",
          ok: relayed.length > 0,
          detail: `matched: ${relayed.join(", ") || "nothing"}`,
        },
        {
          name: "instance not left blocked",
          ok: s.instance.status !== "awaiting",
          detail: `status = ${s.instance.status}`,
        },
        { name: "form complete", ok: s.ev.complete },
        eq("totalAmount", s.ev.values.totalAmount, 980),
      ];
    },
  },
];
