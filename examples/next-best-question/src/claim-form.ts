import { z } from "zod";
import { defineForm, FormRegistry, type FormDef } from "glove-memory/forms";
import type { FormPlanConfig } from "./forms";

/**
 * A first-notice-of-loss intake: who is claiming, what happened, then one of
 * four branch steps. Written in the order a paper form would use. The planner
 * reorders it around what the caller says.
 */
export const claimForm = defineForm({
  id: "claim",
  version: 1,
  name: "Insurance claim",
  description: "First notice of loss: claimant, incident, branch details, evidence.",
  conduct: "One question at a time. Confirm what the caller already said instead of asking it again.",
})
  .step("claimant", { title: "Claimant", preview: "name, policy number, phone" }, (s) =>
    s
      .field("fullName", { schema: z.string().min(2), label: "Full name" })
      .field("policyNumber", { schema: z.string().min(4), label: "Policy number" })
      .field("phone", { schema: z.string().min(6), label: "Contact phone" }),
  )
  .step("incident", { title: "Incident", preview: "type, date, location" }, (s) =>
    s
      .field("incidentType", { schema: z.enum(["vehicle", "property", "injury", "theft"]), label: "Type of incident" })
      .field("incidentDate", { schema: z.string().min(1), label: "When it happened" })
      .field("location", { schema: z.string().min(1), label: "Where it happened" }),
  )
  .step("vehicle", { title: "Vehicle", preview: "registration, other party, driveable", when: (v) => v.incidentType === "vehicle" }, (s) =>
    s
      .field("vehicleReg", { schema: z.string().min(2), label: "Vehicle registration", when: (v) => v.incidentType === "vehicle" })
      .field("otherParty", { schema: z.boolean(), label: "Another party involved", when: (v) => v.incidentType === "vehicle" })
      .field("driveable", { schema: z.boolean(), label: "Vehicle still driveable", when: (v) => v.incidentType === "vehicle" }),
  )
  .step("property", { title: "Property", preview: "cause, damaged areas, safe to live in", when: (v) => v.incidentType === "property" }, (s) =>
    s
      .field("damageCause", { schema: z.enum(["water", "fire", "storm", "other"]), label: "Cause of damage", when: (v) => v.incidentType === "property" })
      .field("damagedAreas", { schema: z.string().min(1), label: "What was damaged", when: (v) => v.incidentType === "property" })
      .field("habitable", { schema: z.boolean(), label: "Home still safe to live in", when: (v) => v.incidentType === "property" }),
  )
  .step("injury", { title: "Injury", preview: "who was hurt, treatment", when: (v) => v.incidentType === "injury" }, (s) =>
    s
      .field("injuredPerson", { schema: z.string().min(1), label: "Who was hurt", when: (v) => v.incidentType === "injury" })
      .field("treatment", { schema: z.boolean(), label: "Medical treatment received", when: (v) => v.incidentType === "injury" }),
  )
  .step("theft", { title: "Theft", preview: "items, police reference, forced entry", when: (v) => v.incidentType === "theft" }, (s) =>
    s
      .field("itemsStolen", { schema: z.string().min(1), label: "What was stolen", when: (v) => v.incidentType === "theft" })
      .field("policeReport", { schema: z.string().min(1), label: "Police reference number", when: (v) => v.incidentType === "theft" })
      .field("forcedEntry", { schema: z.boolean(), label: "Signs of forced entry", when: (v) => v.incidentType === "theft" }),
  )
  .step("evidence", { title: "Evidence", preview: "photos" }, (s) =>
    s.field("photos", { schema: z.boolean(), label: "Photos available" }),
  )
  .build();

export type ClaimFieldId =
  | "fullName" | "policyNumber" | "phone"
  | "incidentType" | "incidentDate" | "location"
  | "vehicleReg" | "otherParty" | "driveable"
  | "damageCause" | "damagedAreas" | "habitable"
  | "injuredPerson" | "treatment"
  | "itemsStolen" | "policeReport" | "forcedEntry"
  | "photos";

export type ClaimBranch = "vehicle" | "property" | "injury" | "theft";

/**
 * What the classifier reads. Written as plain statements, because an NLI
 * model judges whether a statement follows from the text; an
 * instruction-following classifier (Jev, an LLM) reads them just as well.
 *
 * The phrasings were compared on the bench's own openings
 * (`src/phrasing.ts`), so the bench's coverage numbers are optimistic for
 * callers it hasn't seen.
 */
export const claimPlan: FormPlanConfig = {
  branch: {
    field: "incidentType",
    instructions: "What kind of insurance claim is this?",
    labels: {
      vehicle: "A car was damaged.",
      property: "A home was damaged.",
      injury: "A person was injured.",
      theft: "Something was stolen.",
    },
  },
  // Yes/no and pick-one fields list their answers: covered when the caller
  // settled it either way. NLI scores "The car cannot be driven." far better
  // than "The speaker says whether the car can be driven."
  covered: {
    fullName: "The speaker says their name.",
    policyNumber: "The message contains a policy number.",
    phone: "The message contains a phone number.",
    incidentDate: "The speaker says when it happened.",
    location: "The speaker says where it happened.",
    vehicleReg: "The message contains a car registration plate number.",
    otherParty: ["Another vehicle or driver was involved.", "No other vehicle or driver was involved."],
    driveable: ["The car can still be driven.", "The car cannot be driven."],
    damageCause: ["The damage was caused by water.", "The damage was caused by fire.", "The damage was caused by a storm.", "The damage was caused by a vehicle."],
    damagedAreas: "The speaker says which rooms or parts of the home were damaged.",
    habitable: ["The home is still safe to live in.", "The home is not safe to live in."],
    injuredPerson: "The speaker says who was hurt.",
    treatment: ["The injured person received medical treatment.", "The injured person has not had medical treatment."],
    itemsStolen: "The speaker says what was stolen.",
    policeReport: "The message contains a police crime reference number.",
    forcedEntry: ["Something was broken or forced open.", "Nothing was broken or forced open."],
    photos: ["The speaker has photos.", "The speaker has no photos."],
  },
  groups: {
    claimant: "The speaker is giving their name, policy or contact details.",
    incident: "The speaker is describing what happened, when or where.",
    vehicle: "The speaker is talking about a car or vehicle.",
    property: "The speaker is talking about their home or building.",
    injury: "The speaker is talking about an injury or someone being hurt.",
    theft: "The speaker is talking about something stolen.",
    evidence: "The speaker is talking about photos or evidence.",
  },
};

export function claimRegistry(def: FormDef<any> = claimForm): FormRegistry {
  return new FormRegistry().register("claim", {
    name: "Insurance claim",
    description: "First notice of loss",
    load: async () => def,
  });
}
