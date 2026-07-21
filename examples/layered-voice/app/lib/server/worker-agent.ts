// The WORKER agent — the heavy capability layer behind Nova.
//
// It never speaks to the user. It receives delegated requests over the mesh
// (which surface as resolved inbox items), researches the seeded database with
// its full tool surface, and replies to the front agent via
// `glove_mesh_send_message` threaded with `in_reply_to`. Per the paper (§4) it
// NEVER acknowledges — an ack would resolve the front agent's pending reminder
// before any results exist.

import { Glove, Displaymanager, type IGloveRunnable, type StoreAdapter, type ToolResultData } from "glove-core";
import { z } from "zod";
import { buildModel } from "./models";
import * as db from "../data/queries";
import { STATS } from "../data/seed";

const ok = (data: unknown): ToolResultData => ({ status: "success", data });

const WORKER_SYSTEM_PROMPT = `You are the capability layer behind "Nova", a voice assistant at the front desk of ORBITAL DYNAMICS — a starship sales and service center. You do the real work: database lookups, quotes, warranty checks, bookings.

# How you receive work
Requests arrive in your inbox as mesh messages from the front agent (id: "front"). Each inbox line looks like:
  [mesh:from:front] Request: "Message from "Voice Front" (front) [message id: msg_...]" -> Response: "<the actual question>"
Read the ACTUAL QUESTION from the Response text, and note the [message id: msg_...] — you must thread your reply to it.

# How you reply — CRITICAL
- Do the research with your tools, then send ONE reply with glove_mesh_send_message:
    to: "front", in_reply_to: "<the message id from the inbox line>", content: "<your findings>"
- NEVER call glove_mesh_acknowledge on a delegated request. An ack would prematurely unblock the front agent before you have an answer. Only ever reply with in_reply_to set.
- If you genuinely cannot answer (bad data, missing hull, etc.), STILL reply with in_reply_to and an honest explanation — never go silent.
- Write the content for a voice assistant to read aloud: lead with the answer in 1-3 sentences, include the concrete numbers/ids that matter, and keep it tight. Nova will paraphrase; you supply the facts. You may add a short "detail:" section for anything Nova might be asked as a follow-up.

# Your tools (over the live shop database)
- shop_overview — orient yourself: what the center sells and services.
- search_catalog — models for sale, filter by class/price/range/cargo/stock.
- get_model — full specs, stock, and warranty terms for one model.
- lookup_customer — find a customer by name or id; returns their account and owned hulls.
- get_ship — details for a registered hull by id (e.g. KES-0007) or nickname (e.g. "Rustbucket").
- service_history — full service history for a hull.
- check_warranty — warranty status + what the class policy covers/excludes for a hull.
- parts_lookup — parts by SKU, name, or compatible ship class; price, stock, lead time.
- quote_repair — itemize a repair quote from part SKUs + labor hours.
- financing_options — financing plans for a model and customer tier, with monthly estimates.
- list_appointments — appointments by customer or hull.
- book_appointment — book a service slot for a hull (this actually writes).

# Grounding
Today is ${STATS.todayIso}. Prices are in credits (cr). Be exact with hull ids, part SKUs, and numbers — do not invent them; if a lookup returns "found: false", say so plainly in your reply. The center currently lists ${STATS.models} models, ${STATS.ships} registered hulls, and ${STATS.customers} customer accounts.`;

export function buildWorkerAgent(store: StoreAdapter): IGloveRunnable {
  const agent = new Glove({
    store,
    model: buildModel("worker", true),
    displayManager: new Displaymanager(),
    systemPrompt: WORKER_SYSTEM_PROMPT,
    serverMode: true,
    compaction_config: { compaction_instructions: "Summarize the delegated requests handled and their outcomes." },
  })
    .fold({
      name: "shop_overview",
      description: "Get a high-level overview of what Orbital Dynamics sells and services.",
      inputSchema: z.object({}),
      async do() {
        return ok(db.shopOverview());
      },
    })
    .fold({
      name: "search_catalog",
      description: "Search ships for sale. All filters optional; combine them to narrow results.",
      inputSchema: z.object({
        shipClass: z.string().optional().describe("One of: Hauler, Courier, Interceptor, Yacht, Miner, Shuttle, Explorer"),
        maxPriceCredits: z.number().optional().describe("Maximum price in credits"),
        minRangeLy: z.number().optional().describe("Minimum jump range in light-years"),
        minCargoTonnes: z.number().optional().describe("Minimum cargo capacity in tonnes"),
        inStockOnly: z.boolean().optional().describe("Only models with units currently on the lot"),
      }),
      async do(input) {
        return ok(db.searchCatalog(input));
      },
    })
    .fold({
      name: "get_model",
      description: "Full specs, stock, and warranty terms for one ship model, by id or name.",
      inputSchema: z.object({ idOrName: z.string().describe("Model id (e.g. kestrel-l2) or name (e.g. 'Kestrel L2 Hauler')") }),
      async do(input) {
        return ok(db.getModel(input.idOrName));
      },
    })
    .fold({
      name: "lookup_customer",
      description: "Find a customer account by name or id. Returns tier, balance, home port, notes, and the hulls they own.",
      inputSchema: z.object({ query: z.string().describe("Customer name (full or partial) or customer id") }),
      async do(input) {
        return ok(db.lookupCustomer(input.query));
      },
    })
    .fold({
      name: "get_ship",
      description: "Details for a registered hull by hull id (e.g. KES-0007) or nickname (e.g. 'Rustbucket'): model, owner, warranty, recent service.",
      inputSchema: z.object({ hullIdOrNickname: z.string().describe("Hull id or nickname") }),
      async do(input) {
        return ok(db.getShip(input.hullIdOrNickname));
      },
    })
    .fold({
      name: "service_history",
      description: "Full service history for a hull, most recent first.",
      inputSchema: z.object({ hullId: z.string().describe("Hull id or nickname") }),
      async do(input) {
        return ok(db.serviceHistory(input.hullId));
      },
    })
    .fold({
      name: "check_warranty",
      description: "Warranty status for a hull plus what the ship-class policy covers and excludes.",
      inputSchema: z.object({ hullId: z.string().describe("Hull id or nickname") }),
      async do(input) {
        return ok(db.checkWarranty(input.hullId));
      },
    })
    .fold({
      name: "parts_lookup",
      description: "Look up parts by SKU, name, or compatible ship class. Returns price, stock, and lead time.",
      inputSchema: z.object({
        sku: z.string().optional().describe("Part SKU, e.g. PART-0004"),
        name: z.string().optional().describe("Part name or fragment, e.g. 'phase coil'"),
        compatibleClass: z.string().optional().describe("Ship class the part must fit"),
      }),
      async do(input) {
        return ok(db.partsLookup(input));
      },
    })
    .fold({
      name: "quote_repair",
      description: "Build an itemized repair quote from part SKUs and labor hours. Look up the parts first to get real SKUs.",
      inputSchema: z.object({
        hullId: z.string().optional().describe("Hull the quote is for"),
        partSkus: z.array(z.string()).optional().describe("Part SKUs to include"),
        laborHours: z.number().describe("Estimated labor hours"),
        note: z.string().optional().describe("Short description of the work"),
      }),
      async do(input) {
        return ok(db.quoteRepair(input));
      },
    })
    .fold({
      name: "financing_options",
      description: "Financing plans available for a model and customer tier, with down-payment and monthly estimates.",
      inputSchema: z.object({
        modelId: z.string().optional().describe("Model id or name to price against"),
        tier: z.string().optional().describe("Customer tier: Standard, Preferred, or Fleet"),
      }),
      async do(input) {
        return ok(db.financingOptions(input));
      },
    })
    .fold({
      name: "list_appointments",
      description: "List service appointments, filtered by customer or hull.",
      inputSchema: z.object({
        customerId: z.string().optional().describe("Customer id or name"),
        hullId: z.string().optional().describe("Hull id"),
        onlyUpcoming: z.boolean().optional().describe("Only future, non-cancelled appointments"),
      }),
      async do(input) {
        return ok(db.listAppointments(input));
      },
    })
    .fold({
      name: "book_appointment",
      description: "Book a service appointment for a hull. This writes to the schedule. Confirm the hull exists first.",
      inputSchema: z.object({
        hullId: z.string().describe("Hull id or nickname"),
        reason: z.string().describe("Reason for the visit"),
        preferredDate: z.string().optional().describe("Preferred ISO date (YYYY-MM-DD)"),
      }),
      async do(input) {
        return ok(db.bookAppointment(input));
      },
    })
    .build();

  return agent;
}
