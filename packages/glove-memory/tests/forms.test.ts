import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { MemorySchema } from "../src/core/schema";
import {
  compileForm,
  defineForm,
  describeType,
  evaluateForm,
  FormRegistry,
  FormRunner,
  projectView,
  renderTier0,
  type FormDef,
  type FormExecutorContext,
} from "../src/forms";
import { FormDefinitionError, FormStaleError } from "../src/core/errors";
import { InMemoryFormAdapter } from "../src/in-memory/forms";

// ─── Fixtures ─────────────────────────────────────────────────────────────

const provenance = {
  source: "test",
  actor: "test",
  timestamp: "2026-01-01T00:00:00.000Z",
};

/** One-revision history, for the hand-built instance fixtures below. */
function rev(value: unknown, seq: number) {
  return {
    revisions: [{ value, at: provenance.timestamp, provenance, seq }],
    cursor: 0,
  };
}

interface Recorded {
  hookId: string;
  idempotencyKey: string;
  values: Record<string, unknown>;
}

function intake(opts: {
  log?: Recorded[];
  conflict?: (values: any) => string | undefined;
  version?: number;
  onFillPatch?: boolean;
} = {}): FormDef<any, any> {
  const log = opts.log ?? [];
  const record = (ctx: FormExecutorContext<any>) => {
    log.push({
      hookId: ctx.hookId,
      idempotencyKey: ctx.idempotencyKey,
      values: { ...ctx.values },
    });
  };

  return defineForm({
    id: "pi-intake",
    version: opts.version ?? 3,
    name: "Personal injury intake",
    description: "Collects claimant, incident, and injury details.",
    conduct: "Conversational, one or two questions at a time.",
  })
    .step("identity", { title: "Claimant", preview: "name, contact details" }, (s) =>
      s
        .field("fullName", {
          schema: z.string().min(2),
          label: "Full name",
          ask: "Get their full legal name.",
          async onFill(ctx) {
            record(ctx);
            if (opts.onFillPatch) return { patch: { referenceCode: "REF-1" } };
          },
        })
        .field("email", { schema: z.string().email(), label: "Email" })
        .field("phone", { schema: z.string().optional(), label: "Phone" }),
    )
    .step(
      "incident",
      {
        title: "Incident",
        preview: "date, type, what happened",
        when: (_v, s) => s.stepComplete("identity"),
      },
      (s) =>
        s
          .field("incidentType", {
            schema: z.enum(["vehicle", "premises", "medical"]),
            label: "Type of incident",
          })
          .field("vehicleCount", {
            schema: z.number().int().min(1).optional(),
            label: "Vehicles involved",
            when: (v) => v.incidentType === "vehicle",
          })
          .field("description", { schema: z.string().min(10), label: "What happened" })
          .field("referenceCode", { schema: z.string().optional(), label: "Reference" })
          .onComplete(async (ctx) => {
            record(ctx);
          }),
    )
    .checkpoint("conflict-check", {
      when: (v) => Boolean(v.fullName && v.email),
      blocking: true,
      waitMessage: "Running a conflicts check — one moment.",
      async run(ctx) {
        record(ctx);
        const hit = opts.conflict?.(ctx.values);
        if (hit) return { fail: hit };
      },
    })
    .checkpoint("escalate-medical", {
      when: (v) => v.incidentType === "medical",
      async run(ctx) {
        record(ctx);
      },
    })
    .onComplete(async (ctx) => {
      record(ctx);
    })
    .build();
}

function harness(def: FormDef<any, any> = intake()) {
  const schema = new MemorySchema();
  const adapter = new InMemoryFormAdapter({ schema });
  const registry = new FormRegistry().register("pi-intake", {
    name: def.name,
    description: def.description,
    load: () => def,
  });
  const runner = new FormRunner(adapter, { registry, subject: "conv-1" });
  return { adapter, registry, runner };
}

// ─── Definition ───────────────────────────────────────────────────────────

test("optionality is derived from the schema, never declared", () => {
  const compiled = compileForm(intake());
  assert.equal(compiled.fieldById.get("fullName")!.required, true);
  assert.equal(compiled.fieldById.get("phone")!.required, false);
  assert.equal(compiled.fieldById.get("vehicleCount")!.required, false);
});

test("field ids are flat across the whole form, and collisions are a definition error", () => {
  const dupe = defineForm({ id: "d", version: 1, name: "d", description: "d" })
    .step("a", { title: "A" }, (s) => s.field("email", { schema: z.string(), label: "E" }))
    .step("b", { title: "B" }, (s) => s.field("email", { schema: z.string(), label: "E" }))
    .build();
  assert.throws(() => compileForm(dupe), (e: unknown) => {
    assert.ok(e instanceof FormDefinitionError);
    assert.deepEqual(e.ids, ["email"]);
    return true;
  });
});

test("types are rendered from zod, not from a type vocabulary", () => {
  assert.equal(describeType(z.string().email()), "email address");
  assert.equal(describeType(z.iso.date()), "date (YYYY-MM-DD)");
  assert.equal(
    describeType(z.enum(["vehicle", "premises", "medical"])),
    "one of: vehicle | premises | medical",
  );
  assert.equal(describeType(z.number().int().min(1).optional()), "integer >= 1");
  assert.equal(describeType(z.string().min(2)), "text (min 2 chars)");
  assert.equal(describeType(z.boolean()), "true or false");
  assert.equal(describeType(z.array(z.string()).min(1)), "list of text (at least 1)");
});

// ─── Writes are never gated ───────────────────────────────────────────────

test("a value for a later step is accepted while step one is open", async () => {
  const { runner } = harness();
  await runner.start("pi-intake");
  const result = await runner.fill({ description: "Rear-ended at a stop light." });

  assert.deepEqual(result.captured, ["description"]);
  assert.equal(result.issues.length, 0);
  assert.equal(result.view.step?.id, "identity");
});

test("one bad value does not reject the rest of the patch", async () => {
  const { runner } = harness();
  await runner.start("pi-intake");
  const result = await runner.fill({
    fullName: "Dana Reeve",
    email: "not-an-email",
    phone: "+1 555 0100",
  });

  assert.deepEqual(result.captured.sort(), ["fullName", "phone"]);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]!.field, "email");

  const email = result.view.fields.find((f) => f.id === "email")!;
  assert.equal(email.status, "invalid");
  assert.ok(email.error);
  // The rejected answer stays visible as invalid rather than reverting to
  // empty, and it is still what to ask about.
  assert.equal(email.ask, true);
});

test("unknown field ids are reported, not fatal", async () => {
  const { runner } = harness();
  await runner.start("pi-intake");
  const result = await runner.fill({ fullName: "Dana Reeve", favouriteColour: "blue" });
  assert.deepEqual(
    result.unknown.map((u) => u.field),
    ["favouriteColour"],
  );
  assert.deepEqual(result.captured, ["fullName"]);
});

// ─── Held entries and repartitioning ──────────────────────────────────────

test("an answer given before it applies is held, then goes live when it applies", async () => {
  const { runner } = harness();
  await runner.start("pi-intake");

  const early = await runner.fill({ vehicleCount: 2 });
  assert.deepEqual(early.held, ["vehicleCount"]);
  assert.deepEqual(early.captured, []);

  const later = await runner.fill({ incidentType: "vehicle" });
  assert.ok(later.captured.includes("incidentType"));

  const view = await runner.inspect({ scope: "field", id: "vehicleCount" });
  assert.equal(view.fields[0]!.status, "filled");
  assert.equal(view.fields[0]!.value, 2);
});

test("a revision orphans an entry into held, and reverting brings it back intact", async () => {
  const { runner } = harness();
  await runner.start("pi-intake");
  await runner.fill({ incidentType: "vehicle", vehicleCount: 3 });

  await runner.revise("incidentType", "premises", { reason: "it was a slip and fall" });
  let held = await runner.inspect({ scope: "field", id: "vehicleCount" });
  assert.equal(held.fields[0]!.status, "held");
  assert.equal(held.fields[0]!.value, 3, "the answer is kept, not deleted");

  await runner.revise("incidentType", "vehicle");
  held = await runner.inspect({ scope: "field", id: "vehicleCount" });
  assert.equal(held.fields[0]!.status, "filled");
  assert.equal(held.fields[0]!.value, 3, "the original answer is intact");
});

test("completion counts applicable required fields only", async () => {
  const { runner } = harness();
  await runner.start("pi-intake");
  const result = await runner.fill({
    fullName: "Dana Reeve",
    email: "dana@example.com",
    incidentType: "premises",
    description: "Slipped on an unmarked wet floor.",
  });
  // `vehicleCount` is optional anyway; `phone` is optional. Nothing applicable
  // and required is outstanding.
  assert.equal(result.view.complete, true);
  assert.equal(result.view.status, "complete");
});

test("held values never reach an executor", async () => {
  const log: Recorded[] = [];
  const { runner } = harness(intake({ log }));
  await runner.start("pi-intake");
  await runner.fill({ vehicleCount: 4 });
  await runner.fill({
    fullName: "Dana Reeve",
    email: "dana@example.com",
    incidentType: "premises",
    description: "Slipped on an unmarked wet floor.",
  });

  const formHook = log.find((l) => l.hookId === "form");
  assert.ok(formHook, "form.onComplete ran");
  assert.equal("vehicleCount" in formHook.values, false);
});

// ─── Rising edges and idempotency ─────────────────────────────────────────

test("onFill fires on the crossing into live, once, with a stable key", async () => {
  const log: Recorded[] = [];
  const { runner } = harness(intake({ log }));
  await runner.start("pi-intake");

  await runner.fill({ fullName: "Dana Reeve" });
  const fills = log.filter((l) => l.hookId === "field:fullName");
  assert.equal(fills.length, 1);
  assert.match(fills[0]!.idempotencyKey, /:field:fullName:1$/);

  // Re-stating an accepted answer is not a new crossing.
  await runner.fill({ fullName: "Dana Reeve" });
  assert.equal(log.filter((l) => l.hookId === "field:fullName").length, 1);
});

test("a genuine second crossing gets a fresh occurrence", async () => {
  const log: Recorded[] = [];
  const { runner } = harness(intake({ log }));
  await runner.start("pi-intake");

  await runner.fill({ fullName: "Dana Reeve" });
  await runner.fill({ fullName: "x" }); // fails min(2) — drops out of live
  await runner.fill({ fullName: "Dana Reeve-Ellis" }); // crosses back in

  const fills = log.filter((l) => l.hookId === "field:fullName");
  assert.equal(fills.length, 2);
  assert.notEqual(fills[0]!.idempotencyKey, fills[1]!.idempotencyKey);
  assert.match(fills[1]!.idempotencyKey, /:field:fullName:2$/);
});

test("step.onComplete fires when the step's applicable required fields are valid", async () => {
  const log: Recorded[] = [];
  const { runner } = harness(intake({ log }));
  await runner.start("pi-intake");
  await runner.fill({ fullName: "Dana Reeve", email: "dana@example.com" });
  assert.equal(log.filter((l) => l.hookId === "step:incident").length, 0);

  await runner.fill({
    incidentType: "premises",
    description: "Slipped on an unmarked wet floor.",
  });
  assert.equal(log.filter((l) => l.hookId === "step:incident").length, 1);
});

test("a checkpoint fires on the rising edge of its condition", async () => {
  const log: Recorded[] = [];
  const { runner } = harness(intake({ log }));
  await runner.start("pi-intake");
  await runner.fill({ fullName: "Dana Reeve" });
  assert.equal(log.filter((l) => l.hookId === "checkpoint:conflict-check").length, 0);

  await runner.fill({ email: "dana@example.com" });
  assert.equal(log.filter((l) => l.hookId === "checkpoint:conflict-check").length, 1);

  await runner.fill({ phone: "+1 555 0100" });
  assert.equal(
    log.filter((l) => l.hookId === "checkpoint:conflict-check").length,
    1,
    "still true is not a rising edge",
  );
});

test("an executor patch commits like any other write", async () => {
  const { runner } = harness(intake({ onFillPatch: true }));
  await runner.start("pi-intake");
  const result = await runner.fill({ fullName: "Dana Reeve" });
  const ref = result.view.instanceId;
  assert.ok(ref);

  const view = await runner.inspect({ scope: "field", id: "referenceCode" });
  assert.equal(view.fields[0]!.value, "REF-1");
});

// ─── Blocking checkpoints ─────────────────────────────────────────────────

test("a blocking checkpoint that fails unblocks and surfaces the reason", async () => {
  const { runner } = harness(
    intake({ conflict: () => "Conflict with matter M-42." }),
  );
  await runner.start("pi-intake");
  const result = await runner.fill({
    fullName: "Dana Reeve",
    email: "dana@example.com",
  });

  assert.equal(result.view.status, "active", "the instance is not left parked");
  assert.equal(result.view.blockedOn, undefined);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0]!.message, /M-42/);
  assert.equal(result.failures[0]!.hookId, "checkpoint:conflict-check");
});

test("a blocking checkpoint that passes leaves the form active", async () => {
  const { runner } = harness();
  await runner.start("pi-intake");
  const result = await runner.fill({
    fullName: "Dana Reeve",
    email: "dana@example.com",
  });
  assert.equal(result.failures.length, 0);
  assert.equal(result.view.blockedOn, undefined);
});

// ─── Projection and tiers ─────────────────────────────────────────────────

test("tier 0 names the open step's pending labels and previews what's coming", async () => {
  const { runner, adapter } = harness();
  await runner.start("pi-intake");
  const line = await runner.tier0();

  assert.match(line, /^\[form: pi-intake\] step 1\/2 "Claimant"/m);
  assert.match(line, /pending: Full name, Email, Phone/);
  assert.match(line, /later: Incident \(date, type, what happened\)/);
  // Conduct rides along — it governs every turn, and nothing else surfaces it.
  assert.match(line, /Conversational, one or two questions/);
  assert.ok(await adapter.findInstances({ subject: "conv-1" }));
});

test("tier 0 reports a blocked instance instead of a step", async () => {
  const def = intake();
  const { runner, adapter } = harness(def);
  const started = await runner.start("pi-intake");
  await adapter.commitInstance(
    started.view.instanceId,
    { status: "awaiting", blockedOn: "conflict-check" },
    { ifVersion: (await adapter.getInstance(started.view.instanceId))!.version },
    provenance,
  );

  const line = await runner.tier0();
  assert.match(line, /awaiting "conflict-check" — Running a conflicts check/);
});

test("ask is true only for the open step's unanswered, applicable fields", async () => {
  const { runner } = harness();
  await runner.start("pi-intake");
  await runner.fill({ fullName: "Dana Reeve" });

  const outline = await runner.inspect({ scope: "outline" });
  const byId = new Map(outline.fields.map((f) => [f.id, f]));
  assert.equal(byId.get("fullName")!.ask, false, "already answered");
  assert.equal(byId.get("email")!.ask, true);
  assert.equal(byId.get("description")!.ask, false, "later step");
  assert.equal(byId.get("vehicleCount")!.ask, false, "gated off");
  assert.equal(outline.steps?.length, 2);
});

test("the outline carries per-step counts and previews", async () => {
  const { runner } = harness();
  await runner.start("pi-intake");
  await runner.fill({ fullName: "Dana Reeve", email: "dana@example.com" });

  const outline = await runner.inspect({ scope: "outline" });
  const identity = outline.steps!.find((s) => s.id === "identity")!;
  assert.equal(identity.complete, true);
  assert.equal(identity.filled, 2);
  assert.equal(identity.required, 2);
  const incident = outline.steps!.find((s) => s.id === "incident")!;
  assert.equal(incident.preview, "date, type, what happened");
  assert.equal(incident.open, true, "its gate holds once identity is complete");
});

// ─── Registry laziness ────────────────────────────────────────────────────

test("listing forms never loads a module", async () => {
  let loaded = 0;
  const registry = new FormRegistry().register("pi-intake", {
    name: "Personal injury intake",
    description: "New PI matter.",
    load: () => {
      loaded++;
      return intake();
    },
  });
  const runner = new FormRunner(
    new InMemoryFormAdapter({ schema: new MemorySchema() }),
    { registry, subject: "conv-1" },
  );

  assert.deepEqual(runner.list(), [
    { id: "pi-intake", name: "Personal injury intake", description: "New PI matter." },
  ]);
  assert.equal(loaded, 0);

  await runner.start("pi-intake");
  assert.equal(loaded, 1);
  await runner.fill({ fullName: "Dana Reeve" });
  assert.equal(loaded, 1, "the compile is cached");
});

// ─── Def drift ────────────────────────────────────────────────────────────

test("an instance pinned to an older def goes stale rather than guessing", async () => {
  const schema = new MemorySchema();
  const adapter = new InMemoryFormAdapter({ schema });
  const v3 = new FormRegistry().register("pi-intake", {
    name: "n",
    description: "d",
    load: () => intake({ version: 3 }),
  });
  const runnerV3 = new FormRunner(adapter, { registry: v3, subject: "conv-1" });
  const started = await runnerV3.start("pi-intake");
  await runnerV3.fill({ fullName: "Dana Reeve" });

  const v4 = new FormRegistry().register("pi-intake", {
    name: "n",
    description: "d",
    load: () => intake({ version: 4 }),
  });
  const runnerV4 = new FormRunner(adapter, { registry: v4, subject: "conv-1" });

  await assert.rejects(
    () => runnerV4.fill({ email: "dana@example.com" }),
    (e: unknown) => e instanceof FormStaleError,
  );
  const stored = await adapter.getInstance(started.view.instanceId);
  assert.equal(stored!.status, "stale");
});

test("a def that supplies migrate carries values forward", async () => {
  const schema = new MemorySchema();
  const adapter = new InMemoryFormAdapter({ schema });
  const v3 = new FormRegistry().register("pi-intake", {
    name: "n",
    description: "d",
    load: () => intake({ version: 3 }),
  });
  const started = await new FormRunner(adapter, { registry: v3, subject: "conv-1" }).start(
    "pi-intake",
    { seed: { fullName: "Dana Reeve" } },
  );

  const migrating = defineForm({
    id: "pi-intake",
    version: 4,
    name: "n",
    description: "d",
    migrate: (old: any) => ({ claimantName: old.fullName }),
  })
    .step("identity", { title: "Claimant" }, (s) =>
      s.field("claimantName", { schema: z.string().min(2), label: "Full name" }),
    )
    .build();

  const v4 = new FormRegistry().register("pi-intake", {
    name: "n",
    description: "d",
    load: () => migrating,
  });
  const runnerV4 = new FormRunner(adapter, { registry: v4, subject: "conv-1" });
  const view = await runnerV4.status({ instanceId: started.view.instanceId });

  assert.equal(view.defVersion, 4);
  assert.equal(view.fields.find((f) => f.id === "claimantName")!.value, "Dana Reeve");
});

// ─── Lifecycle ────────────────────────────────────────────────────────────

test("abandoning closes the instance and stops accepting answers", async () => {
  const { runner } = harness();
  await runner.start("pi-intake");
  const closed = await runner.abandon("user declined to continue");
  assert.equal(closed.status, "abandoned");
  assert.equal(closed.closedReason, "user declined to continue");

  await assert.rejects(
    () => runner.fill({ fullName: "Dana Reeve" }, { instanceId: closed.id }),
    /abandoned/,
  );
});

test("seeded answers at start fire their hooks", async () => {
  const log: Recorded[] = [];
  const { runner } = harness(intake({ log }));
  const result = await runner.start("pi-intake", {
    seed: { fullName: "Dana Reeve", email: "dana@example.com" },
  });
  assert.deepEqual(result.captured.sort(), ["email", "fullName"]);
  assert.equal(log.filter((l) => l.hookId === "field:fullName").length, 1);
  assert.equal(
    log.filter((l) => l.hookId === "checkpoint:conflict-check").length,
    1,
    "a checkpoint whose condition already holds fires at start",
  );
});

// ─── Evaluation internals ─────────────────────────────────────────────────

test("repartitioning settles in one pass in the common case", () => {
  const compiled = compileForm(intake());
  const ev = evaluateForm(compiled, {
    id: "i",
    defId: "pi-intake",
    defVersion: 3,
    subject: "s",
    status: "active",
    entries: {
      fullName: rev("Dana Reeve", 1),
      incidentType: rev("vehicle", 2),
      vehicleCount: rev(2, 3),
    },
    revisionSeq: 3,
    occurrences: {},
    dispatches: {},
    version: 1,
    createdAt: provenance.timestamp,
    updatedAt: provenance.timestamp,
  });

  assert.equal(ev.passes, 1);
  assert.equal(ev.defects.length, 0);
  assert.equal(ev.values.vehicleCount, 2);
  assert.deepEqual(ev.held, {});
});

test("projectView defaults to the open step and stays there", () => {
  const compiled = compileForm(intake());
  const instance = {
    id: "i",
    defId: "pi-intake",
    defVersion: 3,
    subject: "s",
    status: "active" as const,
    entries: {},
    revisionSeq: 0,
    occurrences: {},
    dispatches: {},
    version: 1,
    createdAt: provenance.timestamp,
    updatedAt: provenance.timestamp,
  };
  const view = projectView(compiled, instance);
  assert.equal(view.step?.id, "identity");
  assert.deepEqual(
    view.fields.map((f) => f.id),
    ["fullName", "email", "phone"],
  );
  assert.match(renderTier0(compiled, instance), /step 1\/2/);
});

// ─── Field-id aliasing ────────────────────────────────────────────────────

test("a field id that differs only in case or punctuation still lands", async () => {
  const { runner } = harness();
  await runner.start("pi-intake");
  const result = await runner.fill({
    full_name: "Dana Reeve",
    "Email": "dana@example.com",
  });

  assert.deepEqual(result.captured.sort(), ["email", "fullName"]);
  assert.equal(result.unknown.length, 0);
  assert.deepEqual(result.aliased.sort((a, b) => a.sent.localeCompare(b.sent)), [
    { sent: "Email", resolved: "email" },
    { sent: "full_name", resolved: "fullName" },
  ]);
});

test("labels resolve to their field, not just ids", async () => {
  const { runner } = harness();
  await runner.start("pi-intake");
  // "Type of incident" is the label; "incidentType" is the id.
  const result = await runner.fill({ "Type of incident": "premises" });
  assert.deepEqual(result.captured, ["incidentType"]);
});

test("a genuinely unknown id comes back with the nearest real fields", async () => {
  const { runner } = harness();
  await runner.start("pi-intake");
  const result = await runner.fill({ incident_kind: "premises" });

  assert.equal(result.captured.length, 0);
  assert.equal(result.unknown.length, 1);
  assert.equal(result.unknown[0]!.field, "incident_kind");
  assert.ok(
    result.unknown[0]!.didYouMean.includes("incidentType"),
    `suggestions were ${JSON.stringify(result.unknown[0]!.didYouMean)}`,
  );
});

test("an id with nothing close by suggests nothing rather than guessing", async () => {
  const { runner } = harness();
  await runner.start("pi-intake");
  const result = await runner.fill({ zzzzqqq: "x" });
  assert.deepEqual(result.unknown[0]!.didYouMean, []);
});

test("aliasing never silently overwrites a different field", () => {
  // Two fields that collide once case and punctuation are stripped have no
  // safe resolution, so the def is rejected at compile rather than at runtime.
  const colliding = defineForm({ id: "c", version: 1, name: "c", description: "c" })
    .step("a", { title: "A" }, (s) =>
      s
        .field("fullName", { schema: z.string(), label: "Full name" })
        .field("full_name", { schema: z.string(), label: "Legal name" }),
    )
    .build();
  assert.throws(() => compileForm(colliding), (e: unknown) => {
    assert.ok(e instanceof FormDefinitionError);
    return true;
  });
});

test("a quoted number or boolean gets told how to send it, not just that it's wrong", async () => {
  const { runner } = harness();
  await runner.start("pi-intake");
  await runner.fill({ fullName: "Dana Reeve", email: "dana@example.com" });
  // `vehicleCount` is a number; JSON tool calls routinely quote one.
  const result = await runner.fill({ incidentType: "vehicle", vehicleCount: "2" as unknown as number });

  const issue = result.issues.find((i) => i.field === "vehicleCount")!;
  assert.ok(issue, "the quoted number was rejected");
  assert.match(issue.hint!, /JSON number, unquoted/);
});

// ─── Per-field history, retract, undo and redo ────────────────────────────

test("a revision keeps its predecessor instead of overwriting it", async () => {
  const { runner, adapter } = harness();
  const started = await runner.start("pi-intake");
  await runner.fill({ fullName: "Dana Reeve" });
  await runner.revise("fullName", "Dana Reeve-Ellis", { reason: "married name" });

  const log = await runner.history("fullName");
  assert.deepEqual(
    log.revisions.map((r) => r.value),
    ["Dana Reeve", "Dana Reeve-Ellis"],
  );
  assert.deepEqual(
    log.revisions.map((r) => r.inForce),
    [false, true],
  );

  const stored = await adapter.getInstance(started.view.instanceId);
  assert.equal(stored!.entries.fullName!.revisions.length, 2, "nothing was overwritten");
});

test("retracting withdraws the answer without destroying it", async () => {
  const { runner } = harness();
  await runner.start("pi-intake");
  await runner.fill({ fullName: "Dana Reeve", email: "dana@example.com" });

  const result = await runner.retract("email");
  const email = result.view.fields.find((f) => f.id === "email")!;
  assert.equal(email.status, "empty", "no value is in force");
  assert.equal(email.ask, true, "and it is asked for again");

  // The answer is still on the record.
  const log = await runner.history("email");
  assert.equal(log.revisions.length, 2);
  assert.equal(log.revisions[0]!.value, "dana@example.com");
  assert.equal(log.revisions[1]!.retracted, true);
});

test("undo steps back and redo puts it forward again", async () => {
  const { runner } = harness();
  await runner.start("pi-intake");
  await runner.fill({ fullName: "Dana Reeve" });
  await runner.revise("fullName", "Dana Reeve-Ellis");

  const undone = await runner.undo("fullName");
  assert.equal(
    undone.view.fields.find((f) => f.id === "fullName")!.value,
    "Dana Reeve",
  );

  const redone = await runner.redo("fullName");
  assert.equal(
    redone.view.fields.find((f) => f.id === "fullName")!.value,
    "Dana Reeve-Ellis",
  );
});

test("undo with no field takes back the most recent answer anywhere", async () => {
  const { runner } = harness();
  await runner.start("pi-intake");
  await runner.fill({ fullName: "Dana Reeve" });
  await runner.fill({ email: "dana@example.com" });

  const undone = await runner.undo();
  assert.equal(undone.view.fields.find((f) => f.id === "email")!.status, "empty");
  assert.equal(
    undone.view.fields.find((f) => f.id === "fullName")!.value,
    "Dana Reeve",
    "the earlier answer is untouched",
  );
});

test("undoing the only answer leaves the field empty, and redo restores it", async () => {
  const { runner } = harness();
  await runner.start("pi-intake");
  await runner.fill({ fullName: "Dana Reeve" });

  const undone = await runner.undo("fullName");
  assert.equal(undone.view.fields.find((f) => f.id === "fullName")!.status, "empty");

  const redone = await runner.redo("fullName");
  assert.equal(redone.view.fields.find((f) => f.id === "fullName")!.value, "Dana Reeve");
});

test("a retraction can be redone", async () => {
  const { runner } = harness();
  await runner.start("pi-intake");
  await runner.fill({ email: "dana@example.com" });
  await runner.retract("email");

  const back = await runner.undo("email");
  assert.equal(
    back.view.fields.find((f) => f.id === "email")!.value,
    "dana@example.com",
    "undoing the retraction restores the answer",
  );
});

test("the view says what undo and redo would do", async () => {
  const { runner } = harness();
  await runner.start("pi-intake");
  await runner.fill({ fullName: "Dana Reeve" });
  await runner.revise("fullName", "Dana Reeve-Ellis");

  const view = await runner.status();
  assert.deepEqual(view.undo, {
    field: "fullName",
    label: "Full name",
    becomes: "Dana Reeve",
  });
  assert.equal(view.redo, undefined, "nothing to redo at the head of the log");

  await runner.undo("fullName");
  const after = await runner.status();
  assert.equal(after.redo?.field, "fullName");
  assert.equal(after.redo?.becomes, "Dana Reeve-Ellis");
});

test("undo re-fires onFill when the value crosses back into live", async () => {
  const log: Recorded[] = [];
  const { runner } = harness(intake({ log }));
  await runner.start("pi-intake");
  await runner.fill({ fullName: "Dana Reeve" });
  assert.equal(log.filter((l) => l.hookId === "field:fullName").length, 1);

  // Out of live, then back — a genuine second crossing, so a fresh occurrence.
  await runner.undo("fullName");
  await runner.redo("fullName");

  const fills = log.filter((l) => l.hookId === "field:fullName");
  assert.equal(fills.length, 2);
  assert.notEqual(fills[0]!.idempotencyKey, fills[1]!.idempotencyKey);
});

test("there is nothing to undo on an untouched form", async () => {
  const { runner } = harness();
  await runner.start("pi-intake");
  await assert.rejects(() => runner.undo(), /nothing to undo/i);
});

test("retracting a held answer leaves the rest of the history intact", async () => {
  const { runner } = harness();
  await runner.start("pi-intake");
  await runner.fill({ incidentType: "vehicle", vehicleCount: 3 });
  await runner.revise("incidentType", "premises");

  // `vehicleCount` is held. Retracting it is still recorded against its log.
  await runner.retract("vehicleCount");
  const log = await runner.history("vehicleCount");
  assert.equal(log.revisions.length, 2);
  assert.equal(log.revisions[0]!.value, 3);
  assert.equal(log.revisions[1]!.retracted, true);
});
