import type { ClaimBranch, ClaimFieldId } from "./claim-form";

/**
 * Labelled callers for the claim form. Each opens with a message of their own
 * choosing, then answers whatever they are asked. `said` is ground truth for
 * the opening: the fields a careful human reader would not ask for again.
 * `branchStated` says whether the opening makes the claim type clear.
 *
 * Six are deliberately awkward: a tree falling on a car, a car crashing into
 * a garden wall, an injury from a car accident, a theft from a car, a skid
 * that might be an injury claim, and "an accident" with nothing else.
 */
export interface Scenario {
  id: string;
  branch: ClaimBranch;
  branchStated: boolean;
  opening: string;
  said: ClaimFieldId[];
  /** Answers for fields the caller is asked about. Missing ones use `profile` and the templates below. */
  answers?: Partial<Record<ClaimFieldId, { text: string; also?: ClaimFieldId[] }>>;
  profile?: Partial<Record<ClaimFieldId, string | boolean>>;
}

export const scenarios: Scenario[] = [
  // ─── Vehicle ─────────────────────────────────────────────────────────────
  {
    id: "v1-car-park", branch: "vehicle", branchStated: true,
    opening: "Hi, my name's Dana Reyes. Someone reversed into my car in the Tesco car park on King Street yesterday afternoon and drove off. The rear bumper's hanging off but it still drives.",
    said: ["fullName", "location", "incidentDate", "otherParty", "driveable"],
  },
  {
    id: "v2-accident", branch: "vehicle", branchStated: false,
    opening: "I need to make a claim, I've had an accident.",
    said: [],
    answers: { incidentType: { text: "It was in my car, another car pulled out in front of me on the roundabout.", also: ["otherParty"] } },
  },
  {
    id: "v3-lorry", branch: "vehicle", branchStated: true,
    opening: "Hello, policy HX-448210. A lorry clipped my wing mirror on the M6 this morning. The reg of my car is KD19 XRT.",
    said: ["policyNumber", "otherParty", "location", "incidentDate", "vehicleReg"],
  },
  {
    id: "v4-tree", branch: "vehicle", branchStated: true,
    opening: "My car was hit by a falling tree branch during the storm on Tuesday night. It's parked outside my house on Elm Grove and I can't drive it, the windscreen is shattered.",
    said: ["incidentDate", "location", "driveable"],
    profile: { otherParty: false },
  },
  {
    id: "v5-skid", branch: "vehicle", branchStated: false,
    opening: "Hi, it's Sam Okafor, my number is 07700 900456. I skidded on ice and went into a wall.",
    said: ["fullName", "phone"],
    profile: { otherParty: false },
  },
  // ─── Property ────────────────────────────────────────────────────────────
  {
    id: "p1-pipe", branch: "property", branchStated: true,
    opening: "A pipe burst in the upstairs bathroom on Sunday while we were away and water came through the kitchen ceiling. We're staying with my sister because the electrics aren't safe.",
    said: ["damageCause", "incidentDate", "damagedAreas", "habitable"],
  },
  {
    id: "p2-damage", branch: "property", branchStated: true,
    opening: "Hi, I'd like to report some damage at home.",
    said: [],
  },
  {
    id: "p3-fire", branch: "property", branchStated: true,
    opening: "This is Priya Shah, policy PL-20931. We had a chip-pan fire in the kitchen last night at 14 Ash Road. The fire brigade put it out but the kitchen is gutted.",
    said: ["fullName", "policyNumber", "damageCause", "incidentDate", "location", "damagedAreas"],
    profile: { damageCause: "fire" },
  },
  {
    id: "p4-roof", branch: "property", branchStated: true,
    opening: "The storm last weekend took half the tiles off my roof and now rain is getting into the loft.",
    said: ["damageCause", "incidentDate", "damagedAreas"],
    profile: { damageCause: "storm" },
  },
  {
    id: "p5-wall", branch: "property", branchStated: false,
    opening: "Someone's car crashed through my garden wall on Friday night.",
    said: ["incidentDate", "damagedAreas", "damageCause"],
    profile: { damageCause: "other" },
  },
  // ─── Injury ──────────────────────────────────────────────────────────────
  {
    id: "i1-slip", branch: "injury", branchStated: true,
    opening: "I slipped on a wet floor at the Greenway shopping centre on Monday and broke my wrist. I went to A&E at St Mary's and they put it in a cast.",
    said: ["incidentDate", "location", "injuredPerson", "treatment"],
  },
  {
    id: "i2-son", branch: "injury", branchStated: true,
    opening: "My son got hurt and I want to know if we're covered.",
    said: ["injuredPerson"],
  },
  {
    id: "i3-paving", branch: "injury", branchStated: true,
    opening: "Hi, I'm Tom Becker, policy LB-77120. My elderly mother tripped over a loose paving slab outside our house this morning and hurt her hip.",
    said: ["fullName", "policyNumber", "injuredPerson", "location", "incidentDate"],
  },
  {
    id: "i4-dog", branch: "injury", branchStated: true,
    opening: "A dog bit me in the park yesterday, I had to get stitches.",
    said: ["injuredPerson", "location", "incidentDate", "treatment"],
  },
  {
    id: "i5-physio", branch: "injury", branchStated: false,
    opening: "I was injured in a car accident last month and I'm still having physio.",
    said: ["incidentDate", "injuredPerson", "treatment"],
  },
  // ─── Theft ───────────────────────────────────────────────────────────────
  {
    id: "t1-burglary", branch: "theft", branchStated: true,
    opening: "Someone broke into our house through the back door on Saturday night and took my laptop and my wife's jewellery. The police gave us a crime number, 4410/23.",
    said: ["forcedEntry", "incidentDate", "itemsStolen", "policeReport"],
  },
  {
    id: "t2-burgled", branch: "theft", branchStated: true,
    opening: "Hi, I think I've been burgled.",
    said: [],
  },
  {
    id: "t3-bike", branch: "theft", branchStated: true,
    opening: "My bike was stolen from outside the station this morning. It was locked up.",
    said: ["itemsStolen", "location", "incidentDate"],
    profile: { forcedEntry: false },
  },
  {
    id: "t4-handbag", branch: "theft", branchStated: true,
    opening: "This is Lee Grant, 07700 900812. My handbag was snatched on the high street on Thursday. I've reported it, the reference is CR-55102.",
    said: ["fullName", "phone", "itemsStolen", "location", "incidentDate", "policeReport"],
    profile: { forcedEntry: false },
  },
  {
    id: "t5-car-window", branch: "theft", branchStated: false,
    opening: "Someone smashed my car window and stole my sat nav and gym bag overnight.",
    said: ["itemsStolen", "forcedEntry", "incidentDate"],
  },
];

const defaults: Record<ClaimFieldId, string | boolean> = {
  fullName: "Alex Morgan",
  policyNumber: "GN-310557",
  phone: "07700 900123",
  incidentType: "",
  incidentDate: "last Wednesday",
  location: "on Station Road in Leeds",
  vehicleReg: "LM68 PWD",
  otherParty: true,
  driveable: true,
  damageCause: "water",
  damagedAreas: "living room carpet",
  habitable: true,
  injuredPerson: "me",
  treatment: true,
  itemsStolen: "a laptop",
  policeReport: "CR-10442",
  forcedEntry: true,
  photos: true,
};

const branchAnswer: Record<ClaimBranch, string> = {
  vehicle: "It's about my car.",
  property: "It's damage to my home.",
  injury: "Someone was hurt.",
  theft: "Something was stolen.",
};

/** What the caller says when asked about `field`, and what else that reply gives away. */
export function answerFor(s: Scenario, field: ClaimFieldId): { text: string; also: ClaimFieldId[] } {
  const custom = s.answers?.[field];
  if (custom) return { text: custom.text, also: custom.also ?? [] };
  const v = s.profile?.[field] ?? defaults[field];
  const yes = v === true;
  const text: Record<ClaimFieldId, string> = {
    fullName: `My name is ${v}.`,
    policyNumber: `My policy number is ${v}.`,
    phone: `You can reach me on ${v}.`,
    incidentType: branchAnswer[s.branch],
    incidentDate: `It happened ${v}.`,
    location: `It was ${v}.`,
    vehicleReg: `The registration is ${v}.`,
    otherParty: yes ? "Yes, another driver was involved." : "No, no other vehicle was involved.",
    driveable: yes ? "Yes, I can still drive it." : "No, it can't be driven.",
    damageCause: v === "water" ? "It was water damage from a leak." : v === "other" ? "Something else caused it." : `It was ${v} damage.`,
    damagedAreas: `The ${v} was damaged.`,
    habitable: yes ? "Yes, we can still live there." : "No, it isn't safe to stay there.",
    injuredPerson: v === "me" ? "It was me who got hurt." : `It was ${v} who got hurt.`,
    treatment: yes ? "Yes, they were seen by a doctor." : "No, no medical treatment yet.",
    itemsStolen: `They took ${v}.`,
    policeReport: `The crime reference is ${v}.`,
    forcedEntry: yes ? "Yes, they forced their way in." : "No, there was no sign of forced entry.",
    photos: yes ? "Yes, I've got photos." : "No, I don't have any photos.",
  };
  return { text: text[field], also: [] };
}

/** The value recorded once a field is captured. */
export function valueFor(s: Scenario, field: ClaimFieldId): unknown {
  return field === "incidentType" ? s.branch : s.profile?.[field] ?? defaults[field];
}
