import { composeAgent } from "glove-foundry";
import calendar from "./apps/calendar.app.js";
import tripContext from "./layers/trip-context.layer.js";
import travellerMemory from "./memory/traveller.memory.js";
import usage from "./subscribers/usage.subscriber.js";
import findFlights from "./tools/find-flights.tool.js";

/**
 * Composition is by value, not by string id. Rename a file and the import
 * breaks at compile time instead of failing at runtime.
 */
export const conciergeComponents = composeAgent(
  calendar,
  findFlights,
  travellerMemory,
  tripContext,
  usage,
);
