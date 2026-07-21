// ─────────────────────────────────────────────────────────────────────────────
// Orbital Dynamics — Starship Sales & Service Center
//
// The seeded "database" the WORKER agent researches over. It is deliberately
// large and interconnected so delegated questions have real substance:
// a catalog for sale, customer accounts, registered hulls, service history,
// a parts warehouse, technicians, bays, appointments, warranties, financing.
//
// Data is generated from a fixed seed, so the dataset is identical on every
// restart — scripted demos and tests hit the same records every time. A handful
// of hand-authored "hero" records give scenarios memorable, predictable targets
// (e.g. Dr. Vasquez Okonkwo's Kestrel "Rustbucket", hull KES-0007).
// ─────────────────────────────────────────────────────────────────────────────

export type ShipClass =
  | "Hauler"
  | "Courier"
  | "Interceptor"
  | "Yacht"
  | "Miner"
  | "Shuttle"
  | "Explorer";

export type CustomerTier = "Standard" | "Preferred" | "Fleet";
export type WarrantyStatus = "active" | "expired" | "void";
export type ServiceType =
  | "Inspection"
  | "Repair"
  | "Overhaul"
  | "Upgrade"
  | "Recall"
  | "Warranty";
export type ServiceStatus = "completed" | "in-progress" | "scheduled";

export interface ShipModel {
  id: string;
  name: string;
  manufacturer: string;
  shipClass: ShipClass;
  priceCredits: number;
  rangeLy: number; // jump range in light-years
  cargoTonnes: number;
  crewCapacity: number;
  driveType: string;
  warrantyMonths: number;
  unitsInStock: number;
  tagline: string;
  description: string;
}

export interface Customer {
  id: string;
  name: string;
  tier: CustomerTier;
  joinedYear: number;
  commChannel: string; // how we reach them
  accountBalanceCredits: number; // positive = credit, negative = owed
  homePort: string;
  notes: string;
}

export interface Ship {
  hullId: string;
  modelId: string;
  ownerCustomerId: string;
  nickname: string;
  commissionedYear: number;
  lightYearsFlown: number;
  warrantyStatus: WarrantyStatus;
  warrantyExpires: string; // ISO date
  lastServiceDate: string; // ISO date
  registryNotes: string;
}

export interface ServiceRecord {
  id: string;
  hullId: string;
  date: string; // ISO date
  type: ServiceType;
  summary: string;
  laborHours: number;
  partsUsed: string[]; // part SKUs
  costCredits: number;
  technicianId: string;
  status: ServiceStatus;
}

export interface Part {
  sku: string;
  name: string;
  category: string;
  priceCredits: number;
  stock: number;
  compatibleClasses: ShipClass[];
  leadTimeDays: number;
}

export interface Technician {
  id: string;
  name: string;
  specialty: string;
  certLevel: "Journeyman" | "Master" | "Chief";
  bayIds: string[];
}

export interface ServiceBay {
  id: string;
  name: string;
  capability: string;
  status: "open" | "occupied" | "maintenance";
}

export interface Appointment {
  id: string;
  hullId: string;
  customerId: string;
  date: string; // ISO date
  bayId: string;
  technicianId: string;
  reason: string;
  status: "scheduled" | "checked-in" | "completed" | "cancelled";
}

export interface FinancingPlan {
  id: string;
  name: string;
  aprPct: number;
  termMonths: number;
  minDownPct: number;
  tierRequired: CustomerTier;
  notes: string;
}

export interface WarrantyPolicy {
  shipClass: ShipClass;
  coverageMonths: number;
  coveredSystems: string[];
  exclusions: string[];
  transferable: boolean;
}

// ── Deterministic PRNG (mulberry32) ──────────────────────────────────────────
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
const rand = mulberry32(0x0007b17); // "orbit" — fixed seed
const rnd = () => rand();
const int = (min: number, max: number) => Math.floor(rnd() * (max - min + 1)) + min;
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
const chance = (p: number) => rnd() < p;
const round = (n: number, step: number) => Math.round(n / step) * step;
/** Deterministic ISO date `daysAgo` days before a fixed "today". */
const TODAY = new Date("2287-05-14T00:00:00Z");
function dateDaysAgo(days: number): string {
  const d = new Date(TODAY.getTime() - days * 86400000);
  return d.toISOString().slice(0, 10);
}
function dateDaysAhead(days: number): string {
  const d = new Date(TODAY.getTime() + days * 86400000);
  return d.toISOString().slice(0, 10);
}

// ── Ship catalog (hand-authored) ─────────────────────────────────────────────
export const SHIP_MODELS: ShipModel[] = [
  {
    id: "kestrel-l2",
    name: "Kestrel L2 Hauler",
    manufacturer: "Meridian Yards",
    shipClass: "Hauler",
    priceCredits: 480_000,
    rangeLy: 18,
    cargoTonnes: 640,
    crewCapacity: 3,
    driveType: "Meridian FoldCore II",
    warrantyMonths: 36,
    unitsInStock: 4,
    tagline: "The workhorse that refuses to quit.",
    description:
      "The best-selling mid-tonnage hauler in the belt. Forgiving handling, cheap parts, and a cargo bay you can reconfigure in an afternoon.",
  },
  {
    id: "kestrel-l4",
    name: "Kestrel L4 Heavy Hauler",
    manufacturer: "Meridian Yards",
    shipClass: "Hauler",
    priceCredits: 910_000,
    rangeLy: 22,
    cargoTonnes: 1450,
    crewCapacity: 5,
    driveType: "Meridian FoldCore IV",
    warrantyMonths: 36,
    unitsInStock: 2,
    tagline: "When the contract is bigger than the belt.",
    description:
      "Double the bay of the L2 with reinforced spars for high-density ore. Popular with fleet operators running fixed lanes.",
  },
  {
    id: "nimbus-courier",
    name: "Nimbus Courier",
    manufacturer: "Corvid Astronautics",
    shipClass: "Courier",
    priceCredits: 265_000,
    rangeLy: 31,
    cargoTonnes: 60,
    crewCapacity: 2,
    driveType: "Corvid Whisperjet",
    warrantyMonths: 24,
    unitsInStock: 6,
    tagline: "First to arrive, every time.",
    description:
      "A featherweight courier tuned for point-to-point speed. Whisperjet drive keeps the signature low for sensitive cargo.",
  },
  {
    id: "nimbus-courier-x",
    name: "Nimbus Courier X",
    manufacturer: "Corvid Astronautics",
    shipClass: "Courier",
    priceCredits: 398_000,
    rangeLy: 44,
    cargoTonnes: 72,
    crewCapacity: 2,
    driveType: "Corvid Whisperjet-X",
    warrantyMonths: 24,
    unitsInStock: 3,
    tagline: "The long lane, closed fast.",
    description:
      "Extended-range variant with an overspec heat ladder. The choice for operators bidding on interstitial routes.",
  },
  {
    id: "vanguard-interceptor",
    name: "Vanguard Interceptor",
    manufacturer: "Nyx Aerospace",
    shipClass: "Interceptor",
    priceCredits: 1_250_000,
    rangeLy: 26,
    cargoTonnes: 18,
    crewCapacity: 1,
    driveType: "Nyx Sabre TwinLance",
    warrantyMonths: 18,
    unitsInStock: 1,
    tagline: "Response times measured in heartbeats.",
    description:
      "A single-seat interceptor for patrol and escort work. Ferocious acceleration, unforgiving of a lazy pilot.",
  },
  {
    id: "vanguard-mk2",
    name: "Vanguard Interceptor MkII",
    manufacturer: "Nyx Aerospace",
    shipClass: "Interceptor",
    priceCredits: 1_640_000,
    rangeLy: 29,
    cargoTonnes: 22,
    crewCapacity: 1,
    driveType: "Nyx Sabre TwinLance-R",
    warrantyMonths: 18,
    unitsInStock: 1,
    tagline: "The record-holder, now road-legal.",
    description:
      "The MkII adds a recuperative heat loop and a redundant flight computer. Track-derived, certified for civilian escort.",
  },
  {
    id: "aurelian-yacht",
    name: "Aurelian Yacht",
    manufacturer: "Halcyon Drivewerks",
    shipClass: "Yacht",
    priceCredits: 2_100_000,
    rangeLy: 34,
    cargoTonnes: 40,
    crewCapacity: 8,
    driveType: "Halcyon SereneDrive",
    warrantyMonths: 48,
    unitsInStock: 2,
    tagline: "Arrive rested.",
    description:
      "A pressurized pleasure cruiser with a whisper-quiet drive and a galley worth the fuel. Sold as much on the lounge as the specs.",
  },
  {
    id: "aurelian-grand",
    name: "Aurelian Grand Yacht",
    manufacturer: "Halcyon Drivewerks",
    shipClass: "Yacht",
    priceCredits: 3_850_000,
    rangeLy: 38,
    cargoTonnes: 55,
    crewCapacity: 12,
    driveType: "Halcyon SereneDrive Grand",
    warrantyMonths: 48,
    unitsInStock: 1,
    tagline: "For when the itinerary is the point.",
    description:
      "The flagship. A stateroom, an observation blister, and a drive so smooth the crystal never rings.",
  },
  {
    id: "borehound-miner",
    name: "Borehound Miner",
    manufacturer: "Tycho Heavy Industries",
    shipClass: "Miner",
    priceCredits: 720_000,
    rangeLy: 14,
    cargoTonnes: 380,
    crewCapacity: 4,
    driveType: "Tycho GrindCore",
    warrantyMonths: 30,
    unitsInStock: 3,
    tagline: "Eats rock. Asks for more.",
    description:
      "A rugged extraction platform with an integrated refinery stub. Built to be beaten and to keep going.",
  },
  {
    id: "borehound-deepcore",
    name: "Borehound Deepcore",
    manufacturer: "Tycho Heavy Industries",
    shipClass: "Miner",
    priceCredits: 1_180_000,
    rangeLy: 16,
    cargoTonnes: 520,
    crewCapacity: 6,
    driveType: "Tycho GrindCore-D",
    warrantyMonths: 30,
    unitsInStock: 1,
    tagline: "The seam nobody else can reach.",
    description:
      "Deep-vein variant with a heavier drill head and a reinforced spine. For operators chasing the hard-to-reach carbonaceous bodies.",
  },
  {
    id: "ferry-shuttle",
    name: "Ferry-Class Shuttle",
    manufacturer: "Meridian Yards",
    shipClass: "Shuttle",
    priceCredits: 138_000,
    rangeLy: 9,
    cargoTonnes: 24,
    crewCapacity: 12,
    driveType: "Meridian ShortHop",
    warrantyMonths: 24,
    unitsInStock: 8,
    tagline: "Short hops, done right.",
    description:
      "The station-to-station commuter. Cheap to run, easy to certify, and boringly reliable — which is the whole point.",
  },
  {
    id: "pathfinder-explorer",
    name: "Pathfinder Explorer",
    manufacturer: "Corvid Astronautics",
    shipClass: "Explorer",
    priceCredits: 640_000,
    rangeLy: 52,
    cargoTonnes: 90,
    crewCapacity: 4,
    driveType: "Corvid LongLook",
    warrantyMonths: 36,
    unitsInStock: 2,
    tagline: "The edge of the chart is a suggestion.",
    description:
      "A self-sufficient survey ship with an oversized sensor mast and a fabricator bay. Range you can plan a career around.",
  },
  {
    id: "pathfinder-lr",
    name: "Pathfinder Explorer LR",
    manufacturer: "Corvid Astronautics",
    shipClass: "Explorer",
    priceCredits: 985_000,
    rangeLy: 71,
    cargoTonnes: 105,
    crewCapacity: 5,
    driveType: "Corvid LongLook-R",
    warrantyMonths: 36,
    unitsInStock: 1,
    tagline: "Further, and back.",
    description:
      "Long-range variant with a second reactor and a closed-loop life support suite rated for eighteen-month tours.",
  },
  {
    id: "halcyon-skiff",
    name: "Halcyon Skiff",
    manufacturer: "Halcyon Drivewerks",
    shipClass: "Shuttle",
    priceCredits: 205_000,
    rangeLy: 12,
    cargoTonnes: 16,
    crewCapacity: 6,
    driveType: "Halcyon SereneDrive Lite",
    warrantyMonths: 36,
    unitsInStock: 4,
    tagline: "The short hop, in comfort.",
    description:
      "A luxury shuttle for owners who found the Ferry-Class a little too honest about being a bus.",
  },
];

const MODEL_IDS = SHIP_MODELS.map((m) => m.id);
const modelById = new Map(SHIP_MODELS.map((m) => [m.id, m]));

// ── Parts warehouse (generated from component pools) ─────────────────────────
const PART_POOLS: { category: string; base: number; names: string[] }[] = [
  {
    category: "Drive",
    base: 42_000,
    names: [
      "FoldCore injector array",
      "flux capacitor bank",
      "drive containment ring",
      "phase coil (primary)",
      "phase coil (secondary)",
      "GrindCore bearing set",
      "Whisperjet nozzle liner",
      "TwinLance igniter",
      "SereneDrive vibration damper",
      "LongLook field shaper",
    ],
  },
  {
    category: "Power",
    base: 28_000,
    names: [
      "reactor control rod",
      "fusion pellet cartridge",
      "power bus coupler",
      "capacitor stack",
      "coolant loop pump",
      "emergency cell pack",
    ],
  },
  {
    category: "Avionics",
    base: 14_000,
    names: [
      "flight computer core",
      "inertial nav unit",
      "attitude gyro pack",
      "comms transponder",
      "redundant autopilot board",
      "sensor fusion module",
    ],
  },
  {
    category: "Hull",
    base: 9_000,
    names: [
      "hull plate (dorsal)",
      "hull plate (ventral)",
      "spar reinforcement kit",
      "airlock seal ring",
      "viewport laminate",
      "micrometeor patch kit",
    ],
  },
  {
    category: "LifeSupport",
    base: 11_000,
    names: [
      "CO2 scrubber cartridge",
      "atmosphere recycler core",
      "water reclamation filter",
      "thermal regulator",
      "pressure relief valve",
    ],
  },
  {
    category: "Landing",
    base: 7_500,
    names: [
      "landing strut actuator",
      "gear hydraulic seal",
      "dock clamp assembly",
      "skid pad set",
    ],
  },
  {
    category: "Sensor",
    base: 16_500,
    names: [
      "survey mast element",
      "lidar emitter",
      "spectrometer window",
      "long-range dish motor",
    ],
  },
  {
    category: "Consumable",
    base: 900,
    names: [
      "hydraulic fluid (20L)",
      "coolant charge",
      "sealant tube",
      "filter media pack",
      "lubricant kit",
    ],
  },
];

const ALL_CLASSES: ShipClass[] = [
  "Hauler",
  "Courier",
  "Interceptor",
  "Yacht",
  "Miner",
  "Shuttle",
  "Explorer",
];

function randomClasses(): ShipClass[] {
  if (chance(0.35)) return [...ALL_CLASSES]; // universal fit
  const n = int(1, 4);
  const shuffled = [...ALL_CLASSES].sort(() => rnd() - 0.5);
  return shuffled.slice(0, n);
}

export const PARTS: Part[] = (() => {
  const parts: Part[] = [];
  let n = 1;
  for (const pool of PART_POOLS) {
    for (const name of pool.names) {
      const sku = `PART-${String(n).padStart(4, "0")}`;
      n++;
      parts.push({
        sku,
        name,
        category: pool.category,
        priceCredits: round(pool.base * (0.6 + rnd() * 1.2), 50),
        stock: chance(0.12) ? 0 : int(1, 40),
        compatibleClasses: randomClasses(),
        leadTimeDays: chance(0.7) ? 0 : int(3, 45),
      });
    }
  }
  return parts;
})();
const PART_SKUS = PARTS.map((p) => p.sku);

// ── Service bays & technicians (hand-authored) ───────────────────────────────
export const SERVICE_BAYS: ServiceBay[] = [
  { id: "bay-1", name: "Bay 1 — Light Service", capability: "Inspections, consumables, avionics swaps", status: "open" },
  { id: "bay-2", name: "Bay 2 — Light Service", capability: "Inspections, consumables, avionics swaps", status: "occupied" },
  { id: "bay-3", name: "Bay 3 — Drive Cell", capability: "Drive teardown, containment work", status: "open" },
  { id: "bay-4", name: "Bay 4 — Heavy Dock", capability: "Hull, spar, and cargo-bay work up to 1500t", status: "occupied" },
  { id: "bay-5", name: "Bay 5 — Clean Room", capability: "Reactor, sensor mast, life-support sealing", status: "maintenance" },
  { id: "bay-6", name: "Bay 6 — Detail & Delivery", capability: "Pre-delivery inspection, yacht finishing", status: "open" },
];

export const TECHNICIANS: Technician[] = [
  { id: "tech-ada", name: "Ada Quill", specialty: "FoldCore & GrindCore drives", certLevel: "Chief", bayIds: ["bay-3"] },
  { id: "tech-boro", name: "Boro Achterberg", specialty: "Reactors & power systems", certLevel: "Master", bayIds: ["bay-5"] },
  { id: "tech-cyn", name: "Cyneburg Rao", specialty: "Avionics & flight computers", certLevel: "Master", bayIds: ["bay-1", "bay-2"] },
  { id: "tech-dev", name: "Devi Lindqvist", specialty: "Hull & structural", certLevel: "Chief", bayIds: ["bay-4"] },
  { id: "tech-esk", name: "Esker Vale", specialty: "Interceptor tuning", certLevel: "Master", bayIds: ["bay-3", "bay-1"] },
  { id: "tech-fen", name: "Fen Otsuka", specialty: "Life support & sealing", certLevel: "Journeyman", bayIds: ["bay-5"] },
  { id: "tech-gus", name: "Gus Marchetti", specialty: "Yacht finishing & detail", certLevel: "Master", bayIds: ["bay-6"] },
  { id: "tech-hana", name: "Hana Ozdemir", specialty: "Survey sensors & masts", certLevel: "Master", bayIds: ["bay-5", "bay-6"] },
  { id: "tech-iri", name: "Iris Bäckström", specialty: "General service & inspections", certLevel: "Journeyman", bayIds: ["bay-1", "bay-2"] },
  { id: "tech-jom", name: "Jomo Farrukh", specialty: "Landing gear & docking", certLevel: "Journeyman", bayIds: ["bay-4", "bay-2"] },
];
const TECH_IDS = TECHNICIANS.map((t) => t.id);

// ── Financing & warranty policy (hand-authored) ──────────────────────────────
export const FINANCING_PLANS: FinancingPlan[] = [
  { id: "fin-standard-60", name: "Standard 60", aprPct: 9.9, termMonths: 60, minDownPct: 20, tierRequired: "Standard", notes: "Our baseline plan. Available to any account in good standing." },
  { id: "fin-standard-84", name: "Standard 84", aprPct: 11.4, termMonths: 84, minDownPct: 20, tierRequired: "Standard", notes: "Lower monthly, longer term. Popular with owner-operators." },
  { id: "fin-preferred-48", name: "Preferred 48", aprPct: 6.4, termMonths: 48, minDownPct: 15, tierRequired: "Preferred", notes: "Reduced APR for Preferred-tier accounts." },
  { id: "fin-preferred-72", name: "Preferred 72", aprPct: 7.8, termMonths: 72, minDownPct: 10, tierRequired: "Preferred", notes: "Low down payment for established customers." },
  { id: "fin-fleet-lease", name: "Fleet Lease", aprPct: 5.2, termMonths: 36, minDownPct: 5, tierRequired: "Fleet", notes: "Operating lease with a buyout option. Fleet accounts only; covers scheduled maintenance." },
  { id: "fin-fleet-balloon", name: "Fleet Balloon 60", aprPct: 5.9, termMonths: 60, minDownPct: 10, tierRequired: "Fleet", notes: "Balloon structure to match seasonal cash flow. Fleet accounts only." },
];

export const WARRANTY_POLICIES: WarrantyPolicy[] = [
  { shipClass: "Hauler", coverageMonths: 36, coveredSystems: ["drive", "power", "hull", "landing"], exclusions: ["cargo-bay wear", "consumables", "cosmetic"], transferable: true },
  { shipClass: "Courier", coverageMonths: 24, coveredSystems: ["drive", "avionics", "power"], exclusions: ["consumables", "cosmetic", "overspeed damage"], transferable: true },
  { shipClass: "Interceptor", coverageMonths: 18, coveredSystems: ["drive", "avionics"], exclusions: ["consumables", "track use", "heat-ladder wear", "cosmetic"], transferable: false },
  { shipClass: "Yacht", coverageMonths: 48, coveredSystems: ["drive", "power", "hull", "life-support", "avionics"], exclusions: ["interior finish", "consumables"], transferable: true },
  { shipClass: "Miner", coverageMonths: 30, coveredSystems: ["drive", "power", "hull"], exclusions: ["drill head wear", "consumables", "cosmetic"], transferable: true },
  { shipClass: "Shuttle", coverageMonths: 24, coveredSystems: ["drive", "power", "life-support"], exclusions: ["consumables", "cosmetic"], transferable: true },
  { shipClass: "Explorer", coverageMonths: 36, coveredSystems: ["drive", "power", "hull", "life-support", "sensor"], exclusions: ["consumables", "cosmetic", "expedition damage"], transferable: true },
];

// ── Hero customers & ships (hand-authored, memorable targets) ─────────────────
const HERO_CUSTOMERS: Customer[] = [
  { id: "cust-okonkwo", name: "Dr. Vasquez Okonkwo", tier: "Preferred", joinedYear: 2279, commChannel: "tightbeam · vasquez.okonkwo@halden-station.orb", accountBalanceCredits: 1_200, homePort: "Halden Station", notes: "Xenogeologist. Flies an old L2 hauler for field samples and is fiercely attached to it. Prefers honest estimates over upsells." },
  { id: "cust-tenzin", name: "Mira Tenzin", tier: "Fleet", joinedYear: 2274, commChannel: "ops desk · dispatch@tenzin-courier.co", accountBalanceCredits: -84_500, homePort: "Cerise Docks", notes: "Runs Tenzin Courier Collective — a nine-ship Nimbus fleet on fixed lanes. Cares about turnaround time above all. Net-30 account." },
  { id: "cust-vale", name: "Captain Idris Vale", tier: "Standard", joinedYear: 2285, commChannel: "personal · idris.vale@freemail.orb", accountBalanceCredits: 0, homePort: "Ardent Ring", notes: "Ex-patrol pilot, now private escort. Bought a Vanguard Interceptor last year and pushes it hard." },
  { id: "cust-solenne", name: "The Solenne Trust", tier: "Fleet", joinedYear: 2271, commChannel: "estate office · concierge@solenne.trust", accountBalanceCredits: 320_000, homePort: "Vireo Reach", notes: "Family estate. Owns two Aurelian yachts kept in showroom condition. White-glove expectations; concierge handles all bookings." },
  { id: "cust-ndlovu", name: "Bex Ndlovu", tier: "Standard", joinedYear: 2283, commChannel: "handheld · bex.ndlovu@beltcomm.orb", accountBalanceCredits: -12_300, homePort: "Tycho Freeport", notes: "Independent prospector. Borehound miner takes a beating; comes in for drive and hull work between hauls." },
  { id: "cust-castellanos", name: "Orin Castellanos", tier: "Preferred", joinedYear: 2280, commChannel: "expedition net · orin@longlook-survey.org", accountBalanceCredits: 4_500, homePort: "Meridian Yards", notes: "Survey lead. Pathfinder Explorer is out on eighteen-month tours; service windows are tight and planned far ahead." },
];

const HERO_SHIPS: Ship[] = [
  { hullId: "KES-0007", modelId: "kestrel-l2", ownerCustomerId: "cust-okonkwo", nickname: "Rustbucket", commissionedYear: 2276, lightYearsFlown: 214_800, warrantyStatus: "expired", warrantyExpires: "2279-08-01", lastServiceDate: dateDaysAgo(47), registryNotes: "High hours. Owner has declined two overhaul quotes; keeps it running on targeted repairs. Sentimental hull." },
  { hullId: "NIM-1120", modelId: "nimbus-courier", ownerCustomerId: "cust-tenzin", nickname: "Lane Four", commissionedYear: 2284, lightYearsFlown: 88_400, warrantyStatus: "active", warrantyExpires: dateDaysAhead(190), lastServiceDate: dateDaysAgo(21), registryNotes: "Tenzin fleet hull. Runs the Cerise–Ardent lane. Whisperjet nozzle liner replaced last visit." },
  { hullId: "NIM-1121", modelId: "nimbus-courier", ownerCustomerId: "cust-tenzin", nickname: "Lane Five", commissionedYear: 2284, lightYearsFlown: 91_200, warrantyStatus: "active", warrantyExpires: dateDaysAhead(205), lastServiceDate: dateDaysAgo(63), registryNotes: "Tenzin fleet hull. Flagged for an intermittent nav fault the crew can't reproduce." },
  { hullId: "VAN-0455", modelId: "vanguard-interceptor", ownerCustomerId: "cust-vale", nickname: "Grudge", commissionedYear: 2285, lightYearsFlown: 41_600, warrantyStatus: "active", warrantyExpires: dateDaysAhead(120), lastServiceDate: dateDaysAgo(9), registryNotes: "Heat ladder shows track-grade wear — not covered under the interceptor policy. Owner warned twice." },
  { hullId: "AUR-0012", modelId: "aurelian-yacht", ownerCustomerId: "cust-solenne", nickname: "Evenfall", commissionedYear: 2282, lightYearsFlown: 30_100, warrantyStatus: "active", warrantyExpires: dateDaysAhead(600), lastServiceDate: dateDaysAgo(120), registryNotes: "Solenne Trust. Showroom condition. Detail-only bay; Gus handles it personally." },
  { hullId: "AUR-0013", modelId: "aurelian-grand", ownerCustomerId: "cust-solenne", nickname: "Solstice", commissionedYear: 2286, lightYearsFlown: 8_900, warrantyStatus: "active", warrantyExpires: dateDaysAhead(900), lastServiceDate: dateDaysAgo(64), registryNotes: "Solenne Trust flagship. Under the extended Grand warranty. Concierge books all windows." },
  { hullId: "BOR-0301", modelId: "borehound-miner", ownerCustomerId: "cust-ndlovu", nickname: "Molar", commissionedYear: 2281, lightYearsFlown: 156_700, warrantyStatus: "expired", warrantyExpires: "2286-03-15", lastServiceDate: dateDaysAgo(30), registryNotes: "Drill head near wear limit (excluded from warranty regardless). Hull patched repeatedly around the forward spar." },
  { hullId: "PAT-0088", modelId: "pathfinder-explorer", ownerCustomerId: "cust-castellanos", nickname: "Long Marble", commissionedYear: 2280, lightYearsFlown: 402_500, warrantyStatus: "expired", warrantyExpires: "2285-02-01", lastServiceDate: dateDaysAgo(410), registryNotes: "Currently out on tour. Next service window is narrow and must be pre-staged. Sensor mast element on watch." },
];

// ── Generated customers ──────────────────────────────────────────────────────
const FIRST_NAMES = [
  "Amara", "Bodhi", "Caius", "Dalia", "Enzo", "Freya", "Gideon", "Hesper",
  "Ilya", "Juno", "Kwame", "Lior", "Maeve", "Nadia", "Osei", "Priya",
  "Quill", "Rafi", "Suki", "Tomas", "Uma", "Vidal", "Wren", "Xiomara",
  "Yusuf", "Zaid", "Anouk", "Bram", "Cleo", "Dov", "Esme", "Faisal",
];
const LAST_NAMES = [
  "Adeyemi", "Bianchi", "Cho", "Delacroix", "Eriksson", "Farooq", "Grigoryan",
  "Haddad", "Ito", "Jabari", "Kovač", "Lindgren", "Moreau", "Ngata", " Olsen",
  "Petrov", "Qureshi", "Rasmussen", "Sato", "Trần", "Ustinov", "Vega",
  "Watanabe", "Xu", "Yamada", "Zhao",
].map((s) => s.trim());
const PORTS = ["Halden Station", "Cerise Docks", "Ardent Ring", "Vireo Reach", "Tycho Freeport", "Meridian Yards", "Kestrel Field", "Nyx Gate"];
const TIERS: CustomerTier[] = ["Standard", "Standard", "Standard", "Preferred", "Preferred", "Fleet"];

const genCustomers: Customer[] = [];
for (let i = 0; i < 36; i++) {
  const first = pick(FIRST_NAMES);
  const last = pick(LAST_NAMES);
  const name = `${first} ${last}`;
  const tier = pick(TIERS);
  genCustomers.push({
    id: `cust-g${String(i + 1).padStart(3, "0")}`,
    name,
    tier,
    joinedYear: int(2272, 2286),
    commChannel: `net · ${first.toLowerCase()}.${last.toLowerCase().replace(/[^a-z]/g, "")}@beltcomm.orb`,
    accountBalanceCredits: chance(0.25) ? -int(1, 80) * 1000 : int(0, 20) * 1000,
    homePort: pick(PORTS),
    notes: chance(0.5)
      ? pick([
          "Books online; rarely calls in.",
          "Prefers a call before any work over 5,000 cr.",
          "Long-time customer. Values a straight answer.",
          "New account. Still learning the ship.",
          "Runs tight schedules; hates surprises.",
        ])
      : "",
  });
}

export const CUSTOMERS: Customer[] = [...HERO_CUSTOMERS, ...genCustomers];
const CUSTOMER_IDS = CUSTOMERS.map((c) => c.id);

// ── Generated ships (owned hulls) ────────────────────────────────────────────
const CLASS_PREFIX: Record<ShipClass, string> = {
  Hauler: "KES",
  Courier: "NIM",
  Interceptor: "VAN",
  Yacht: "AUR",
  Miner: "BOR",
  Shuttle: "FER",
  Explorer: "PAT",
};
const NICKNAMES = [
  "Second Wind", "Ledger", "Dusty", "Pole Star", "Margin Call", "Coriolis",
  "Slow Loris", "Overhead", "Tin Can", "Aphelion", "Sundowner", "Break-Even",
  "Loose Change", "Meridian Mary", "Cold Start", "Deadhead", "Backhaul",
  "Fair Winds", "Payload", "Recoup", "Night Shift", "Windfall", "Odd Job",
  "Long Way Round", "Small Mercy", "Ballast", "Gravity Well", "Red Ink",
];

let hullCounter = 100;
const genShips: Ship[] = [];
for (let i = 0; i < 52; i++) {
  const model = pick(SHIP_MODELS);
  const owner = pick(CUSTOMER_IDS);
  const prefix = CLASS_PREFIX[model.shipClass];
  const hullId = `${prefix}-${String((hullCounter += int(1, 4))).padStart(4, "0")}`;
  const commissionedYear = int(2274, 2286);
  const ageYears = 2287 - commissionedYear;
  const warrantyMonths = model.warrantyMonths;
  const warrantyExpiresDate = new Date(`${commissionedYear}-06-01T00:00:00Z`);
  warrantyExpiresDate.setMonth(warrantyExpiresDate.getMonth() + warrantyMonths);
  const warrantyActive = warrantyExpiresDate > TODAY;
  genShips.push({
    hullId,
    modelId: model.id,
    ownerCustomerId: owner,
    nickname: pick(NICKNAMES),
    commissionedYear,
    lightYearsFlown: int(2, 40) * 1000 * Math.max(1, ageYears),
    warrantyStatus: warrantyActive ? (chance(0.05) ? "void" : "active") : "expired",
    warrantyExpires: warrantyExpiresDate.toISOString().slice(0, 10),
    lastServiceDate: dateDaysAgo(int(3, 500)),
    registryNotes: chance(0.4)
      ? pick([
          "Owner-operated. Regular customer.",
          "Bought used; provenance thin before commissioning.",
          "Runs hot on long lanes.",
          "Meticulously maintained.",
          "Overdue for scheduled service.",
        ])
      : "",
  });
}

export const SHIPS: Ship[] = [...HERO_SHIPS, ...genShips];
const SHIP_IDS = SHIPS.map((s) => s.hullId);
const shipById = new Map(SHIPS.map((s) => [s.hullId, s]));

// ── Hero service history (detailed, for scripted scenarios) ──────────────────
const HERO_SERVICE: ServiceRecord[] = [
  { id: "svc-h001", hullId: "KES-0007", date: dateDaysAgo(47), type: "Repair", summary: "Replaced #2 phase coil and coolant loop pump after a jump-abort fault. Declined full drive overhaul (quoted 62,000 cr) again — owner opted for the targeted fix.", laborHours: 14, partsUsed: ["PART-0004", "PART-0015"], costCredits: 21_400, technicianId: "tech-ada", status: "completed" },
  { id: "svc-h002", hullId: "KES-0007", date: dateDaysAgo(203), type: "Repair", summary: "Forward hull plate re-seat and micrometeor patch after belt transit. Recommended spar inspection next visit.", laborHours: 9, partsUsed: ["PART-0021", "PART-0024"], costCredits: 11_900, technicianId: "tech-dev", status: "completed" },
  { id: "svc-h003", hullId: "KES-0007", date: dateDaysAgo(410), type: "Inspection", summary: "Annual inspection. Flagged phase coils as approaching wear limit; drive overhaul recommended. Owner declined.", laborHours: 4, partsUsed: [], costCredits: 2_800, technicianId: "tech-iri", status: "completed" },
  { id: "svc-h010", hullId: "NIM-1121", date: dateDaysAgo(63), type: "Repair", summary: "Chased an intermittent nav fault. Reflashed flight computer and reseated the inertial nav unit; fault not reproduced on the bench. Advised return if it recurs.", laborHours: 6, partsUsed: ["PART-0018"], costCredits: 7_600, technicianId: "tech-cyn", status: "completed" },
  { id: "svc-h011", hullId: "NIM-1120", date: dateDaysAgo(21), type: "Warranty", summary: "Whisperjet nozzle liner replaced under warranty after thermal scoring. No charge to customer.", laborHours: 5, partsUsed: ["PART-0007"], costCredits: 0, technicianId: "tech-ada", status: "completed" },
  { id: "svc-h020", hullId: "VAN-0455", date: dateDaysAgo(9), type: "Inspection", summary: "Post-escort inspection. Heat ladder shows track-grade wear — EXCLUDED from the interceptor warranty. Quoted 18,500 cr for the recuperative loop refresh; owner deferred.", laborHours: 7, partsUsed: [], costCredits: 3_100, technicianId: "tech-esk", status: "completed" },
  { id: "svc-h030", hullId: "AUR-0012", date: dateDaysAgo(120), type: "Upgrade", summary: "Interior refresh and SereneDrive vibration damper swap for a persistent low-frequency ring in the lounge. Solenne concierge signed off.", laborHours: 18, partsUsed: ["PART-0009"], costCredits: 44_800, technicianId: "tech-gus", status: "completed" },
  { id: "svc-h040", hullId: "BOR-0301", date: dateDaysAgo(30), type: "Repair", summary: "GrindCore bearing set replaced; forward spar re-patched. Drill head measured at 91% wear — recommend replacement within two hauls (not warranty-eligible).", laborHours: 22, partsUsed: ["PART-0006", "PART-0022"], costCredits: 38_200, technicianId: "tech-ada", status: "completed" },
  { id: "svc-h050", hullId: "PAT-0088", date: dateDaysAgo(410), type: "Overhaul", summary: "Pre-tour overhaul. Second reactor serviced, sensor mast element flagged for replacement at next window. Closed-loop life support certified for the tour.", laborHours: 40, partsUsed: ["PART-0002", "PART-0031", "PART-0025"], costCredits: 96_500, technicianId: "tech-hana", status: "completed" },
  { id: "svc-h051", hullId: "PAT-0088", date: dateDaysAhead(35), type: "Inspection", summary: "Scheduled tour-return inspection window (pre-staged). Sensor mast element replacement expected.", laborHours: 8, partsUsed: ["PART-0031"], costCredits: 14_200, technicianId: "tech-hana", status: "scheduled" },
];

// ── Generated service history ────────────────────────────────────────────────
const SERVICE_SUMMARIES: Record<ServiceType, string[]> = {
  Inspection: ["Routine annual inspection. No faults found.", "Pre-purchase inspection. Clean bill.", "Scheduled interval inspection; minor advisories noted."],
  Repair: ["Replaced a failed component after a fault code.", "Chased and cleared an intermittent electrical gremlin.", "Sealed a slow coolant leak and topped off."],
  Overhaul: ["Major drive overhaul at interval.", "Full power-system refresh.", "Mid-life structural overhaul."],
  Upgrade: ["Avionics package upgrade.", "Range-extension retrofit.", "Comfort/interior upgrade."],
  Recall: ["Manufacturer recall — igniter batch replacement.", "Recall service: autopilot board revision."],
  Warranty: ["Warranty repair — no charge to customer.", "Covered component replacement under warranty."],
};
const SERVICE_TYPES: ServiceType[] = ["Inspection", "Inspection", "Repair", "Repair", "Repair", "Overhaul", "Upgrade", "Recall", "Warranty"];

let svcCounter = 1;
const genService: ServiceRecord[] = [];
for (const ship of SHIPS) {
  const count = int(0, 4);
  for (let k = 0; k < count; k++) {
    const type = pick(SERVICE_TYPES);
    const nParts = type === "Inspection" ? int(0, 1) : int(1, 3);
    const partsUsed: string[] = [];
    for (let p = 0; p < nParts; p++) partsUsed.push(pick(PART_SKUS));
    const laborHours = type === "Overhaul" ? int(20, 45) : type === "Inspection" ? int(2, 6) : int(4, 16);
    const partsCost = partsUsed.reduce((sum, sku) => sum + (PARTS.find((p) => p.sku === sku)?.priceCredits ?? 0), 0);
    const cost = type === "Warranty" ? 0 : round(laborHours * 850 + partsCost, 50);
    genService.push({
      id: `svc-${String(svcCounter++).padStart(4, "0")}`,
      hullId: ship.hullId,
      date: dateDaysAgo(int(5, 900)),
      type,
      summary: pick(SERVICE_SUMMARIES[type]),
      laborHours,
      partsUsed,
      costCredits: cost,
      technicianId: pick(TECH_IDS),
      status: "completed",
    });
  }
}

export const SERVICE_RECORDS: ServiceRecord[] = [...HERO_SERVICE, ...genService].sort(
  (a, b) => (a.date < b.date ? 1 : -1),
);

// ── Appointments (mutable — book_appointment appends here) ────────────────────
const APPT_REASONS = [
  "Annual inspection", "Drive fault diagnosis", "Warranty claim", "Pre-delivery inspection",
  "Hull patch", "Avionics upgrade", "Reactor service", "Interior detail", "Landing gear service",
];

export const APPOINTMENTS: Appointment[] = (() => {
  const appts: Appointment[] = [];
  // A few hero-linked appointments for scenario continuity.
  appts.push({ id: "appt-h01", hullId: "PAT-0088", customerId: "cust-castellanos", date: dateDaysAhead(35), bayId: "bay-5", technicianId: "tech-hana", reason: "Tour-return inspection (pre-staged)", status: "scheduled" });
  appts.push({ id: "appt-h02", hullId: "NIM-1121", customerId: "cust-tenzin", date: dateDaysAhead(4), bayId: "bay-1", technicianId: "tech-cyn", reason: "Recurring nav fault", status: "scheduled" });
  appts.push({ id: "appt-h03", hullId: "AUR-0013", customerId: "cust-solenne", date: dateDaysAhead(12), bayId: "bay-6", technicianId: "tech-gus", reason: "Scheduled detail", status: "scheduled" });
  let n = 4;
  for (let i = 0; i < 18; i++) {
    const ship = pick(SHIPS);
    appts.push({
      id: `appt-${String(n++).padStart(3, "0")}`,
      hullId: ship.hullId,
      customerId: ship.ownerCustomerId,
      date: chance(0.6) ? dateDaysAhead(int(1, 60)) : dateDaysAgo(int(1, 30)),
      bayId: pick(SERVICE_BAYS).id,
      technicianId: pick(TECH_IDS),
      reason: pick(APPT_REASONS),
      status: pick(["scheduled", "scheduled", "completed", "checked-in", "cancelled"] as Appointment["status"][]),
    });
  }
  return appts;
})();

// ── Convenience lookups (used by the query layer) ────────────────────────────
export const lookups = {
  modelById,
  shipById,
  customerById: new Map(CUSTOMERS.map((c) => [c.id, c])),
  partBySku: new Map(PARTS.map((p) => [p.sku, p])),
  technicianById: new Map(TECHNICIANS.map((t) => [t.id, t])),
  bayById: new Map(SERVICE_BAYS.map((b) => [b.id, b])),
};

export const STATS = {
  models: SHIP_MODELS.length,
  customers: CUSTOMERS.length,
  ships: SHIPS.length,
  serviceRecords: SERVICE_RECORDS.length,
  parts: PARTS.length,
  technicians: TECHNICIANS.length,
  bays: SERVICE_BAYS.length,
  appointments: APPOINTMENTS.length,
  todayIso: TODAY.toISOString().slice(0, 10),
};

export const helpers = { dateDaysAhead, dateDaysAgo };
