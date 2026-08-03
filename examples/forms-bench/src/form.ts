/**
 * The form under test — a travel reimbursement claim.
 *
 * Chosen to stress the parts of the design that are actually contestable:
 *
 * - `mileage` and `ticketReference` are branch-gated on `mode`, so a user who
 *   volunteers either before naming their mode produces a *held* entry. That
 *   is the §5.1 claim, and it's the one a naive implementation gets wrong.
 * - `staffId` has a format a model will plausibly get wrong on first pass,
 *   which is how we watch it recover from a rejection without losing the rest
 *   of the same patch.
 * - Four steps with `preview` strings, so tier 0 has something to advertise
 *   and opportunistic capture has somewhere to aim.
 * - A blocking checkpoint that can reject, so we see whether a model relays a
 *   policy failure or silently carries on.
 */
import { z } from "zod";
import { defineForm } from "glove-memory/forms";

/** Claims above this need written pre-approval; the checkpoint enforces it. */
export const POLICY_CAP = 750;

export const travelClaim = defineForm({
  id: "travel-claim",
  version: 1,
  name: "Travel reimbursement claim",
  description:
    "Collects claimant, trip, travel and approval details for a staff travel reimbursement.",
  conduct:
    "Conversational — one or two questions at a time. Don't read the field list aloud and don't " +
    "number the questions. If the user volunteers something out of order, capture it and carry on " +
    "rather than making them repeat it later. When everything is collected, say so plainly.",
})
  .step(
    "claimant",
    {
      title: "Claimant",
      ask: "Establish who is claiming.",
      preview: "name, staff id, email",
    },
    (s) =>
      s
        .field("fullName", {
          schema: z.string().min(2),
          label: "Full name",
          ask: "Their full name as it appears on the staff directory.",
        })
        .field("staffId", {
          schema: z.string().regex(/^[A-Z]{2}-\d{4}$/),
          label: "Staff ID",
          hint: "Two capital letters, a hyphen, then four digits — like FN-4471.",
        })
        .field("email", {
          schema: z.string().email(),
          label: "Work email",
        }),
  )
  .step(
    "trip",
    {
      title: "Trip",
      preview: "destination, dates, purpose",
      when: (_v, s) => s.stepComplete("claimant"),
    },
    (s) =>
      s
        .field("destination", { schema: z.string().min(2), label: "Destination" })
        .field("departDate", { schema: z.iso.date(), label: "Departure date" })
        .field("returnDate", { schema: z.iso.date(), label: "Return date" })
        .field("purpose", {
          schema: z.enum(["client-visit", "conference", "training", "internal"]),
          label: "Purpose of trip",
        }),
  )
  .step(
    "travel",
    {
      title: "Travel",
      preview: "how they travelled, mileage or ticket reference, total cost",
      when: (_v, s) => s.stepComplete("trip"),
    },
    (s) =>
      s
        .field("mode", {
          schema: z.enum(["car", "rail", "air"]),
          label: "Mode of travel",
        })
        .field("mileage", {
          schema: z.number().int().min(1).optional(),
          label: "Miles driven",
          ask: "Total round-trip miles in their own vehicle.",
          when: (v) => v.mode === "car",
        })
        .field("ticketReference", {
          schema: z.string().min(4).optional(),
          label: "Ticket reference",
          when: (v) => v.mode === "rail" || v.mode === "air",
        })
        .field("totalAmount", {
          schema: z.number().min(0),
          label: "Total claimed (GBP)",
        }),
  )
  .step(
    "approval",
    {
      title: "Approval",
      preview: "cost centre, approving manager, receipts",
      when: (_v, s) => s.stepComplete("travel"),
    },
    (s) =>
      s
        .field("costCentre", { schema: z.string().min(3), label: "Cost centre" })
        .field("managerEmail", { schema: z.string().email(), label: "Approving manager's email" })
        .field("receiptsAttached", { schema: z.boolean(), label: "Receipts attached" }),
  )
  .checkpoint("policy-cap", {
    // Rising edge only — it fires the first commit the total crosses the cap.
    when: (v) => typeof v.totalAmount === "number" && v.totalAmount > POLICY_CAP,
    blocking: true,
    waitMessage: "Checking this against the travel policy — one moment.",
    run() {
      return {
        fail:
          `£${POLICY_CAP} is the limit a manager can approve on their own. This claim is over it, ` +
          `so it needs written pre-approval from Finance before it can be submitted. Tell the ` +
          `claimant, and carry on collecting the rest.`,
      };
    },
  })
  .build();
