import { CUSTOMERS, ORDERS } from "../data/sample-data.js";
import { seedCustomerStoreForTests } from "../data/customer-store.js";
import { TERRITORY_CYCLES } from "../data/territories.js";
import {
  buildRoutePlan,
  isOrderEligible,
  nearestNeighborOrder,
  optimizeStopOrder,
  setWedThreshold,
} from "./planner.js";
import { SCRANTON_DEPOT } from "../../shared/constants.js";
import { AM_PM_TIME_PATTERN } from "../../shared/timeFormat.js";
import { createEstimatedTravelMatrix } from "./travel-time.js";

const REF = new Date("2026-09-10T12:00:00");

seedCustomerStoreForTests(CUSTOMERS, ORDERS);

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const phil1 = TERRITORY_CYCLES.find((c) => c.id === "philadelphia-1")!;
const phil2 = TERRITORY_CYCLES.find((c) => c.id === "philadelphia-2")!;
const phil1Orders = ORDERS.filter((o) => isOrderEligible(o, phil1, REF));
const phil2Orders = ORDERS.filter((o) => isOrderEligible(o, phil2, REF));
assert(phil1Orders.length === 2, `Expected 2 philadelphia-1 orders, got ${phil1Orders.length}`);
assert(phil2Orders.length === 2, `Expected 2 philadelphia-2 orders, got ${phil2Orders.length}`);

const { plan: pittsburgh, matrix } = await buildRoutePlan("pittsburgh", ORDERS, REF);
assert(pittsburgh.allStops.length === 7, `Expected 7 Pittsburgh stops, got ${pittsburgh.allStops.length}`);
assert(pittsburgh.segments.length === 2, "Pittsburgh should have Wed + Thu segments");
const wedCount = pittsburgh.segments[0].stops.length;
const thuCount = pittsburgh.segments[1].stops.length;
assert(wedCount + thuCount === 7, "All Pittsburgh stops must be assigned");
assert(wedCount > 0 && thuCount >= 0, "Wednesday must have at least one primary stop");
assert(
  (pittsburgh.suggestedWedThreshold ?? 0) === wedCount,
  "Suggested Wed threshold should match initial split"
);
const wedFirst = pittsburgh.segments[0].stops[0]?.stopId;
if (wedFirst) {
  assert(
    pittsburgh.segments[0].validation.stopEtas[wedFirst] === "10:00 AM",
    "Wednesday first stop must be at 10:00 AM"
  );
}

const moved = setWedThreshold(pittsburgh, 3, matrix);
assert(moved.segments[0].stops.length === 3, "Wed threshold should assign 3 stops");
assert(moved.segments[1].stops.length === 4, "Thu overflow should have remaining 4 stops");

const eta = moved.segments[0].validation.departureTime ?? "";
assert(AM_PM_TIME_PATTERN.test(eta), `Departure time should be AM/PM, got ${eta}`);
const firstStopId = moved.segments[0].stops[0]?.stopId;
if (firstStopId) {
  assert(
    moved.segments[0].validation.stopEtas[firstStopId] === "10:00 AM",
    "First stop of each day must be at 10:00 AM"
  );
}
const thuFirst = moved.segments[1].stops[0]?.stopId;
if (thuFirst) {
  assert(
    moved.segments[1].validation.stopEtas[thuFirst] === "10:00 AM",
    "Thursday first stop must be at 10:00 AM"
  );
}

console.log("All planner tests passed.");

const pittsburghStops = pittsburgh.allStops;
const pittsburghMatrix = createEstimatedTravelMatrix(SCRANTON_DEPOT, pittsburghStops);
const naive = nearestNeighborOrder(pittsburghStops, SCRANTON_DEPOT, pittsburghMatrix);
const optimized = optimizeStopOrder(
  pittsburghStops,
  SCRANTON_DEPOT.lat,
  SCRANTON_DEPOT.lng,
  SCRANTON_DEPOT,
  false,
  pittsburghMatrix
);

function pathVehicleMinutes(stops: typeof pittsburghStops, m: typeof pittsburghMatrix) {
  let t = pittsburghStops.length * 10; // SERVICE_MINUTES_PER_STOP
  let cur = { lat: SCRANTON_DEPOT.lat, lng: SCRANTON_DEPOT.lng };
  for (const s of stops) {
    t += m.getDurationMinutes(cur, { lat: s.lat, lng: s.lng });
    cur = { lat: s.lat, lng: s.lng };
  }
  return t;
}

assert(
  pathVehicleMinutes(optimized, pittsburghMatrix) <= pathVehicleMinutes(naive, pittsburghMatrix) + 0.1,
  "Optimized route should minimize vehicle time vs nearest-neighbor"
);

const driveMin = moved.segments[0].validation.stopDriveMinutes?.[firstStopId ?? ""];
assert(typeof driveMin === "number" && driveMin >= 0, "Stop drive minutes should be recorded");
