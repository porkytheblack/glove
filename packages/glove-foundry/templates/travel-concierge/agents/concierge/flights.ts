import { z } from "zod";

/**
 * Searching flights is the concierge's core job, so the tool lives in the
 * agent's `tools` field: every instance has it, nothing to install. Compare
 * `tools/convert-currency.tool.ts`, which an instance opts into.
 *
 * The sample data is deliberately local so a fresh project runs offline.
 * Replace `search` with a call to your own inventory or a provider API.
 */
const SAMPLE_FLIGHTS = [
  { carrier: "Kestrel Air", from: "LIS", to: "NBO", depart: "08:40", hours: 9.5, price: 612 },
  { carrier: "Meridian", from: "LIS", to: "NBO", depart: "13:15", hours: 11, price: 494 },
  { carrier: "Northwind", from: "LIS", to: "NBO", depart: "22:05", hours: 9, price: 738 },
] as const;

function search(from: string, to: string, maxPrice: number) {
  const origin = from.trim().toUpperCase();
  const destination = to.trim().toUpperCase();
  return SAMPLE_FLIGHTS.filter((flight) =>
    (!origin || flight.from === origin) &&
    (!destination || flight.to === destination) &&
    flight.price <= maxPrice
  );
}

export const findFlights = {
  name: "find_flights",
  description:
    "Search flights between two IATA airport codes. Returns carrier, departure time, duration and price in USD.",
  inputSchema: z.object({
    from: z.string().describe("Origin IATA code, for example LIS"),
    to: z.string().describe("Destination IATA code, for example NBO"),
    maxPrice: z.number().default(5_000).describe("Highest acceptable price in USD"),
  }),
  async do({ from, to, maxPrice }: { from: string; to: string; maxPrice: number }) {
    const matches = search(from, to, maxPrice);
    if (matches.length === 0) {
      return { status: "success" as const, data: { matches: [], note: "No flight matched those constraints." } };
    }
    return { status: "success" as const, data: { matches } };
  },
};
