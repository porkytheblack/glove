// Query helpers over the seeded dataset. The WORKER agent's tools are thin
// wrappers around these. Every function is forgiving about partial / fuzzy
// input because a model will call them with whatever the customer said.

import {
  SHIP_MODELS,
  CUSTOMERS,
  SHIPS,
  SERVICE_RECORDS,
  PARTS,
  TECHNICIANS,
  SERVICE_BAYS,
  APPOINTMENTS,
  FINANCING_PLANS,
  WARRANTY_POLICIES,
  lookups,
  helpers,
  type ShipClass,
  type CustomerTier,
  type Appointment,
} from "./seed";

const norm = (s: string) => s.trim().toLowerCase();

function nameParts(s: string): string[] {
  return norm(s)
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

// ── Catalog ──────────────────────────────────────────────────────────────────
export function searchCatalog(opts: {
  shipClass?: string;
  maxPriceCredits?: number;
  minRangeLy?: number;
  minCargoTonnes?: number;
  inStockOnly?: boolean;
}) {
  let results = SHIP_MODELS.slice();
  if (opts.shipClass) {
    const q = norm(opts.shipClass);
    results = results.filter((m) => norm(m.shipClass) === q || norm(m.shipClass).startsWith(q));
  }
  if (typeof opts.maxPriceCredits === "number") results = results.filter((m) => m.priceCredits <= opts.maxPriceCredits!);
  if (typeof opts.minRangeLy === "number") results = results.filter((m) => m.rangeLy >= opts.minRangeLy!);
  if (typeof opts.minCargoTonnes === "number") results = results.filter((m) => m.cargoTonnes >= opts.minCargoTonnes!);
  if (opts.inStockOnly) results = results.filter((m) => m.unitsInStock > 0);
  return results.map((m) => ({
    id: m.id,
    name: m.name,
    manufacturer: m.manufacturer,
    shipClass: m.shipClass,
    priceCredits: m.priceCredits,
    rangeLy: m.rangeLy,
    cargoTonnes: m.cargoTonnes,
    unitsInStock: m.unitsInStock,
    tagline: m.tagline,
  }));
}

export function getModel(idOrName: string) {
  const q = norm(idOrName);
  const model =
    lookups.modelById.get(q) ??
    SHIP_MODELS.find((m) => norm(m.name) === q) ??
    SHIP_MODELS.find((m) => norm(m.name).includes(q) || norm(m.id).includes(q));
  if (!model) return { found: false as const, query: idOrName };
  const warranty = WARRANTY_POLICIES.find((w) => w.shipClass === model.shipClass);
  return { found: true as const, model, warranty };
}

// ── Customers ────────────────────────────────────────────────────────────────
export function lookupCustomer(query: string) {
  const q = norm(query);
  const direct = lookups.customerById.get(q);
  let matches = direct ? [direct] : [];
  if (!matches.length) {
    matches = CUSTOMERS.filter((c) => norm(c.name) === q);
  }
  if (!matches.length) {
    const parts = nameParts(query);
    matches = CUSTOMERS.filter((c) => {
      const hay = norm(c.name);
      return parts.every((p) => hay.includes(p));
    });
  }
  if (!matches.length) return { found: false as const, query, candidates: [] as string[] };

  const shaped = matches.slice(0, 5).map((c) => {
    const ships = SHIPS.filter((s) => s.ownerCustomerId === c.id).map((s) => ({
      hullId: s.hullId,
      nickname: s.nickname,
      model: lookups.modelById.get(s.modelId)?.name ?? s.modelId,
      warrantyStatus: s.warrantyStatus,
      lastServiceDate: s.lastServiceDate,
    }));
    return {
      id: c.id,
      name: c.name,
      tier: c.tier,
      joinedYear: c.joinedYear,
      commChannel: c.commChannel,
      accountBalanceCredits: c.accountBalanceCredits,
      homePort: c.homePort,
      notes: c.notes,
      ships,
    };
  });
  return { found: true as const, matches: shaped };
}

// ── Ships ────────────────────────────────────────────────────────────────────
export function getShip(hullIdOrNickname: string) {
  const q = norm(hullIdOrNickname);
  const ship =
    lookups.shipById.get(hullIdOrNickname.toUpperCase()) ??
    lookups.shipById.get(hullIdOrNickname) ??
    SHIPS.find((s) => norm(s.hullId) === q) ??
    SHIPS.find((s) => norm(s.nickname) === q) ??
    SHIPS.find((s) => norm(s.nickname).includes(q) || norm(s.hullId).includes(q));
  if (!ship) return { found: false as const, query: hullIdOrNickname };
  const model = lookups.modelById.get(ship.modelId);
  const owner = lookups.customerById.get(ship.ownerCustomerId);
  const recentService = SERVICE_RECORDS.filter((r) => r.hullId === ship.hullId).slice(0, 3);
  return {
    found: true as const,
    ship,
    model: model ? { name: model.name, shipClass: model.shipClass, manufacturer: model.manufacturer } : null,
    owner: owner ? { id: owner.id, name: owner.name, tier: owner.tier } : null,
    recentService: recentService.map((r) => ({ date: r.date, type: r.type, summary: r.summary })),
  };
}

export function serviceHistory(hullId: string) {
  const ship = getShip(hullId);
  if (!ship.found) return { found: false as const, query: hullId };
  const records = SERVICE_RECORDS.filter((r) => r.hullId === ship.ship.hullId).map((r) => ({
    id: r.id,
    date: r.date,
    type: r.type,
    summary: r.summary,
    laborHours: r.laborHours,
    costCredits: r.costCredits,
    technician: lookups.technicianById.get(r.technicianId)?.name ?? r.technicianId,
    status: r.status,
    parts: r.partsUsed.map((sku) => lookups.partBySku.get(sku)?.name ?? sku),
  }));
  return { found: true as const, hullId: ship.ship.hullId, nickname: ship.ship.nickname, count: records.length, records };
}

// ── Warranty ─────────────────────────────────────────────────────────────────
export function checkWarranty(hullId: string) {
  const ship = getShip(hullId);
  if (!ship.found) return { found: false as const, query: hullId };
  const shipClass = ship.model?.shipClass as ShipClass | undefined;
  const policy = shipClass ? WARRANTY_POLICIES.find((w) => w.shipClass === shipClass) : undefined;
  return {
    found: true as const,
    hullId: ship.ship.hullId,
    nickname: ship.ship.nickname,
    warrantyStatus: ship.ship.warrantyStatus,
    warrantyExpires: ship.ship.warrantyExpires,
    shipClass,
    policy: policy
      ? {
          coverageMonths: policy.coverageMonths,
          coveredSystems: policy.coveredSystems,
          exclusions: policy.exclusions,
          transferable: policy.transferable,
        }
      : null,
    registryNotes: ship.ship.registryNotes,
  };
}

// ── Parts ────────────────────────────────────────────────────────────────────
export function partsLookup(opts: { sku?: string; name?: string; compatibleClass?: string }) {
  let results = PARTS.slice();
  if (opts.sku) {
    const q = norm(opts.sku);
    results = results.filter((p) => norm(p.sku) === q || norm(p.sku).includes(q));
  }
  if (opts.name) {
    const parts = nameParts(opts.name);
    results = results.filter((p) => {
      const hay = norm(p.name);
      return parts.every((w) => hay.includes(w));
    });
  }
  if (opts.compatibleClass) {
    const q = opts.compatibleClass.toLowerCase();
    results = results.filter((p) => p.compatibleClasses.some((c) => c.toLowerCase() === q));
  }
  return results.slice(0, 25).map((p) => ({
    sku: p.sku,
    name: p.name,
    category: p.category,
    priceCredits: p.priceCredits,
    stock: p.stock,
    inStock: p.stock > 0,
    leadTimeDays: p.leadTimeDays,
    compatibleClasses: p.compatibleClasses,
  }));
}

// ── Repair quote ─────────────────────────────────────────────────────────────
const LABOR_RATE = 850; // credits/hour
export function quoteRepair(opts: { hullId?: string; partSkus?: string[]; laborHours: number; note?: string }) {
  const lineItems: { label: string; amount: number }[] = [];
  const missing: string[] = [];
  for (const sku of opts.partSkus ?? []) {
    const part = lookups.partBySku.get(sku.toUpperCase()) ?? lookups.partBySku.get(sku);
    if (!part) {
      missing.push(sku);
      continue;
    }
    lineItems.push({ label: `${part.name} (${part.sku})`, amount: part.priceCredits });
    if (part.stock <= 0) {
      lineItems.push({ label: `— backorder: ${part.name} (~${part.leadTimeDays}d lead)`, amount: 0 });
    }
  }
  const laborAmount = Math.round(opts.laborHours * LABOR_RATE);
  lineItems.push({ label: `Labor — ${opts.laborHours}h @ ${LABOR_RATE} cr/h`, amount: laborAmount });
  const subtotal = lineItems.reduce((s, li) => s + li.amount, 0);
  const shopFee = Math.round(subtotal * 0.04);
  const total = subtotal + shopFee;
  return {
    hullId: opts.hullId ?? null,
    note: opts.note ?? null,
    lineItems: [...lineItems, { label: "Shop fee (4%)", amount: shopFee }],
    subtotalCredits: subtotal,
    totalCredits: total,
    unknownParts: missing,
  };
}

// ── Financing ────────────────────────────────────────────────────────────────
const TIER_RANK: Record<CustomerTier, number> = { Standard: 0, Preferred: 1, Fleet: 2 };
export function financingOptions(opts: { modelId?: string; tier?: string }) {
  const model = opts.modelId ? getModel(opts.modelId) : null;
  const price = model && model.found ? model.model.priceCredits : undefined;
  const tier = (opts.tier as CustomerTier) ?? "Standard";
  const rank = TIER_RANK[tier] ?? 0;
  const eligible = FINANCING_PLANS.filter((p) => TIER_RANK[p.tierRequired] <= rank);
  return {
    modelName: model && model.found ? model.model.name : null,
    priceCredits: price ?? null,
    tier,
    plans: eligible.map((p) => {
      let estimate: { downCredits: number; monthlyCredits: number } | null = null;
      if (typeof price === "number") {
        const down = Math.round((p.minDownPct / 100) * price);
        const financed = price - down;
        const r = p.aprPct / 100 / 12;
        const monthly = r === 0 ? financed / p.termMonths : (financed * r) / (1 - Math.pow(1 + r, -p.termMonths));
        estimate = { downCredits: down, monthlyCredits: Math.round(monthly) };
      }
      return {
        id: p.id,
        name: p.name,
        aprPct: p.aprPct,
        termMonths: p.termMonths,
        minDownPct: p.minDownPct,
        tierRequired: p.tierRequired,
        notes: p.notes,
        estimate,
      };
    }),
  };
}

// ── Appointments ─────────────────────────────────────────────────────────────
export function listAppointments(opts: { customerId?: string; hullId?: string; onlyUpcoming?: boolean }) {
  let results = APPOINTMENTS.slice();
  if (opts.customerId) {
    const c = lookupCustomer(opts.customerId);
    const ids = c.found ? c.matches.map((m) => m.id) : [opts.customerId];
    results = results.filter((a) => ids.includes(a.customerId));
  }
  if (opts.hullId) {
    const q = norm(opts.hullId);
    results = results.filter((a) => norm(a.hullId) === q || norm(a.hullId).includes(q));
  }
  if (opts.onlyUpcoming) {
    results = results.filter((a) => a.date >= STATS_TODAY && a.status !== "cancelled" && a.status !== "completed");
  }
  return results
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(0, 25)
    .map((a) => ({
      id: a.id,
      hullId: a.hullId,
      customer: lookups.customerById.get(a.customerId)?.name ?? a.customerId,
      date: a.date,
      bay: lookups.bayById.get(a.bayId)?.name ?? a.bayId,
      technician: lookups.technicianById.get(a.technicianId)?.name ?? a.technicianId,
      reason: a.reason,
      status: a.status,
    }));
}
const STATS_TODAY = helpers.dateDaysAhead(0);

let apptCounter = 1000;
export function bookAppointment(opts: { hullId: string; reason: string; preferredDate?: string }) {
  const ship = getShip(opts.hullId);
  if (!ship.found) return { booked: false as const, reason: `No registered hull matches "${opts.hullId}".` };
  // Pick an open bay and a qualified-enough technician; fall back gracefully.
  const openBay = SERVICE_BAYS.find((b) => b.status === "open") ?? SERVICE_BAYS[0];
  const tech = TECHNICIANS.find((t) => t.bayIds.includes(openBay.id)) ?? TECHNICIANS[0];
  const date = opts.preferredDate ?? helpers.dateDaysAhead(7);
  const appt: Appointment = {
    id: `appt-${apptCounter++}`,
    hullId: ship.ship.hullId,
    customerId: ship.ship.ownerCustomerId,
    date,
    bayId: openBay.id,
    technicianId: tech.id,
    reason: opts.reason,
    status: "scheduled",
  };
  APPOINTMENTS.push(appt);
  return {
    booked: true as const,
    appointment: {
      id: appt.id,
      hullId: appt.hullId,
      date: appt.date,
      bay: openBay.name,
      technician: tech.name,
      reason: appt.reason,
    },
  };
}

// ── Shop overview (for the worker's grounding) ───────────────────────────────
export function shopOverview() {
  return {
    center: "Orbital Dynamics — Starship Sales & Service",
    today: STATS_TODAY,
    modelsForSale: SHIP_MODELS.length,
    registeredHulls: SHIPS.length,
    customers: CUSTOMERS.length,
    technicians: TECHNICIANS.length,
    bays: SERVICE_BAYS.map((b) => ({ name: b.name, status: b.status })),
    financingPlans: FINANCING_PLANS.map((p) => p.name),
  };
}
