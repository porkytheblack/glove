/**
 * How to word a coverage statement for an NLI classifier.
 *
 * For each field, scores two phrasings of "has the caller already given
 * this?" against every opening in the bench where the field applies:
 *
 * - `meta`: a statement about the message ("The speaker says whether the car
 *   can still be driven."), the natural way to ask an instruction-following
 *   classifier.
 * - `chosen`: what `claimPlan` uses, usually the possible answers ("The car
 *   can still be driven." / "The car cannot be driven.").
 *
 *   pnpm --filter glove-next-best-question-example phrasing
 */
import { noul } from "glove-classifier";
import { claimPlan, type ClaimFieldId } from "./claim-form";
import { pickClassifier } from "./classifiers";
import { scenarios } from "./scenarios";

const meta: Partial<Record<ClaimFieldId, string>> = {
  fullName: "The speaker says their name.",
  policyNumber: "The speaker gives a policy number.",
  phone: "The speaker gives a phone number.",
  incidentDate: "The speaker says when it happened.",
  location: "The speaker says where it happened.",
  vehicleReg: "The speaker gives a vehicle registration number.",
  otherParty: "The speaker says whether another driver or vehicle was involved.",
  driveable: "The speaker says whether the car can still be driven.",
  damageCause: "The speaker says what caused the damage.",
  damagedAreas: "The speaker says which rooms or parts of the home were damaged.",
  habitable: "The speaker says whether the home is still safe to live in.",
  injuredPerson: "The speaker says who was hurt.",
  treatment: "The speaker says whether the injured person got medical treatment.",
  itemsStolen: "The speaker says what was stolen.",
  policeReport: "The speaker gives a police or crime reference number.",
  forcedEntry: "The speaker says whether there were signs of a break-in.",
};
const branchOf: Partial<Record<ClaimFieldId, string>> = {
  vehicleReg: "vehicle", otherParty: "vehicle", driveable: "vehicle",
  damageCause: "property", damagedAreas: "property", habitable: "property",
  injuredPerson: "injury", treatment: "injury",
  itemsStolen: "theft", policeReport: "theft", forcedEntry: "theft",
};
const at = Number(process.env.CONFIRM_AT ?? 0.8);

const classifier = await pickClassifier();
console.log(`classifier: ${classifier.name}; a field counts as covered at p ≥ ${at}\n`);
console.log("| Field | Meta phrasing | Answer phrasing |");
console.log("| --- | --: | --: |");
const totals = { meta: [0, 0], chosen: [0, 0] };
for (const [field, metaStatement] of Object.entries(meta) as Array<[ClaimFieldId, string]>) {
  const chosen = claimPlan.covered![field]!;
  const cells: string[] = [];
  for (const [name, statements] of [["meta", [metaStatement]], ["chosen", typeof chosen === "string" ? [chosen] : chosen]] as const) {
    let right = 0, n = 0;
    for (const s of scenarios) {
      if (branchOf[field] && branchOf[field] !== s.branch) continue;
      const questions = Object.fromEntries(statements.map((st, i) => [`s${i}`, noul(st)]));
      const { answers } = await classifier.classify({ state: s.opening, questions });
      const p = Math.max(...Object.values(answers).map((a) => (a.type === "noul" ? a.noul : 0)));
      if ((p >= at) === s.said.includes(field)) right++;
      n++;
    }
    totals[name][0]! += right;
    totals[name][1]! += n;
    cells.push(`${right}/${n}`);
  }
  console.log(`| ${field} | ${cells.join(" | ")} |`);
}
const pct = ([r, n]: number[]) => `${((100 * r!) / n!).toFixed(0)}%`;
console.log(`| **all** | **${pct(totals.meta)}** | **${pct(totals.chosen)}** |`);
