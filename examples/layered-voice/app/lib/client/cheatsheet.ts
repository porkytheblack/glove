// The in-UI cheat sheet: the seeded "hero" records worth knowing when driving
// a demo by voice. Hand-authored mirror of the hand-authored hero rows in
// app/lib/data/seed.ts (the seed is deterministic, so these are stable across
// restarts) — kept separate so the client bundle doesn't drag in the whole
// generated dataset.

export interface CheatShip {
  hullId: string;
  nickname: string;
  model: string;
  owner: string;
  hook: string; // why this hull is interesting to ask about
  ask: string[]; // lines that exercise it (click-to-fill)
}

export const CHEAT_TODAY = "2287-05-14";

export const CHEAT_SHIPS: CheatShip[] = [
  {
    hullId: "KES-0007",
    nickname: "Rustbucket",
    model: "Kestrel L2 Hauler",
    owner: "Dr. Vasquez Okonkwo (Preferred)",
    hook: "High-hours sentimental hauler, warranty EXPIRED. Owner has declined a 62,000 cr drive overhaul twice; phase coils flagged at wear limit.",
    ask: [
      "Nova, what's the service history on hull KES-0007?",
      "Nova, what repairs are recommended for the Rustbucket, and what would they cost?",
      "Is KES-0007 still under warranty?",
    ],
  },
  {
    hullId: "NIM-1121",
    nickname: "Lane Five",
    model: "Nimbus Courier",
    owner: "Mira Tenzin — Tenzin Courier Collective (Fleet)",
    hook: "Fleet courier flagged for an intermittent nav fault the shop couldn't reproduce. Already has an appointment in 4 days (bay 1, Cyneburg Rao).",
    ask: [
      "Nova, has the nav fault on NIM-1121 ever been resolved?",
      "Nova, when is Lane Five's next appointment and who's the technician?",
    ],
  },
  {
    hullId: "VAN-0455",
    nickname: "Grudge",
    model: "Vanguard Interceptor",
    owner: "Captain Idris Vale (Standard)",
    hook: "Heat ladder shows track-grade wear — EXCLUDED from the interceptor warranty. 18,500 cr recuperative-loop refresh quoted and deferred. Good warranty-dispute scene.",
    ask: [
      "Nova, is the heat ladder wear on VAN-0455 covered under warranty?",
      "Nova, what did the last inspection on the Grudge find?",
    ],
  },
  {
    hullId: "BOR-0301",
    nickname: "Molar",
    model: "Borehound Miner",
    owner: "Bex Ndlovu (Standard, owes 12,300 cr)",
    hook: "Drill head measured at 91% wear — replacement recommended within two hauls, never warranty-eligible. Owner account is in the red.",
    ask: [
      "Nova, how urgent is the drill head on BOR-0301?",
      "Nova, what does Bex Ndlovu currently owe the shop?",
    ],
  },
  {
    hullId: "PAT-0088",
    nickname: "Long Marble",
    model: "Pathfinder Explorer",
    owner: "Orin Castellanos (Preferred)",
    hook: "Out on an 18-month survey tour; a narrow pre-staged inspection window opens in ~35 days. Sensor mast element on watch.",
    ask: [
      "Nova, is everything staged for the Long Marble's return window?",
      "Nova, which parts are reserved for PAT-0088's next inspection?",
    ],
  },
  {
    hullId: "AUR-0013",
    nickname: "Solstice",
    model: "Aurelian Grand Yacht",
    owner: "The Solenne Trust (Fleet, white-glove)",
    hook: "Showroom-condition flagship under the extended Grand warranty. Concierge books everything; detail scheduled in 12 days with Gus.",
    ask: [
      "Nova, confirm the Solstice's upcoming detail appointment for the Solenne concierge.",
    ],
  },
];

/** Sales-side prompts — no hull needed, exercises catalog/financing tools. */
export const CHEAT_SALES: string[] = [
  "Nova, what do you have in stock under 300,000 credits?",
  "Nova, compare the Nimbus Courier and the Courier X for long lanes.",
  "Nova, what financing could a Preferred customer get on a Pathfinder Explorer?",
  "Nova, I need something with at least 500 tonnes of cargo — options?",
  "Nova, book KES-0007 in for a spar inspection next week.",
];

/** Multi-speaker beats that show addressing differentiation (speak as different people). */
export const CHEAT_ADDRESSING: { as: string; line: string; expect: string }[] = [
  {
    as: "customer",
    line: "Hi — I'm Vasquez Okonkwo, I'm here about my hauler.",
    expect: "Nova greets and engages (addressed to her).",
  },
  {
    as: "operator",
    line: "Kit, can you clear bay three after lunch?",
    expect: "Nova stays SILENT — people talking to each other.",
  },
  {
    as: "bystander",
    line: "Apparently the Okonkwo hauler threw another jump-abort fault on approach.",
    expect: "Nova stays silent but REMEMBERS it — ask her about KES-0007 next and she'll use it.",
  },
];
