/**
 * Compile-time check that the builder threads types the way §1 says it does.
 *
 * This file is never executed — `tsc --noEmit` over it is the whole test. If
 * `.field()` stops widening the accumulated values type, or `ctx.values` stops
 * narrowing to the real shape, this stops compiling.
 */
import { z } from "zod";
import { defineForm } from "../src/forms";

declare function expectType<T>(value: T): void;

export const piIntake = defineForm({
  id: "pi-intake",
  version: 3,
  name: "Personal injury intake",
  description: "Collects claimant, incident, and injury details for a new PI matter.",
  conduct:
    "Conversational, one or two questions at a time. Don't read the field list aloud. " +
    "If the user volunteers something out of order, capture it and carry on.",
})
  .step(
    "identity",
    {
      title: "Claimant",
      ask: "Establish who you're speaking with.",
      preview: "name, contact details",
    },
    (s) =>
      s
        .field("fullName", {
          schema: z.string().min(2),
          label: "Full name",
          ask: "Get their full legal name as it would appear on a filing.",
        })
        .field("email", {
          schema: z.string().email(),
          label: "Email",
          hint: "Needs to be a working address — this is where documents go.",
        })
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
        .field("incidentDate", { schema: z.iso.date(), label: "Date of incident" })
        .field("incidentType", {
          schema: z.enum(["vehicle", "premises", "medical", "product", "other"]),
          label: "Type of incident",
        })
        .field("vehicleCount", {
          schema: z.number().int().min(1).optional(),
          label: "Vehicles involved",
          // `v.incidentType` narrows to the enum union declared two lines up.
          when: (v) => v.incidentType === "vehicle",
        })
        .field("description", { schema: z.string().min(40), label: "What happened" }),
  )
  .step(
    "injury",
    {
      title: "Injury",
      preview: "treatment sought, providers",
      when: (_v, s) => s.stepComplete("incident"),
    },
    (s) =>
      s
        .field("treated", { schema: z.boolean(), label: "Sought treatment" })
        .field("provider", {
          schema: z.string().optional(),
          label: "Treating provider",
          when: (v) => v.treated === true,
        }),
  )
  .checkpoint("conflict-check", {
    when: (v) => Boolean(v.fullName && v.email),
    blocking: true,
    waitMessage: "Running a conflicts check — one moment.",
    async run(ctx) {
      expectType<string | undefined>(ctx.values.fullName);
      expectType<string | undefined>(ctx.values.email);
      if (ctx.values.fullName === "blocked") {
        return { fail: `Conflict on ${ctx.values.fullName}.` };
      }
    },
  })
  .checkpoint("escalate-medical", {
    when: (v) => v.incidentType === "medical",
    async run(ctx) {
      expectType<string>(ctx.idempotencyKey);
    },
  })
  .onComplete(async (ctx) => {
    // Fully typed at the callsite: the enum narrows, the optionals stay optional.
    expectType<string>(ctx.values.fullName);
    expectType<"vehicle" | "premises" | "medical" | "product" | "other">(
      ctx.values.incidentType,
    );
    expectType<number | undefined>(ctx.values.vehicleCount);
    expectType<string | undefined>(ctx.values.phone);
    expectType<boolean>(ctx.values.treated);
  })
  .build();
