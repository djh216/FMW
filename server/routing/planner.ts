import {
  DEFAULT_TRUCK_CAPACITY,
  MAX_DRIVER_HOURS,
  SCRANTON_DEPOT,
  SERVICE_MINUTES_PER_STOP,
} from "../../shared/constants.js";
import { formatMinutesAsTime, formatTimeOfDay } from "../../shared/timeFormat.js";
import type {
  Depot,
  Order,
  RoutePlan,
  Segment,
  SegmentValidation,
  Stop,
  StopAssignment,
  TerritoryCycle,
} from "../../shared/types.js";
import { getCustomerById } from "../data/customer-store.js";
import { getCycleById } from "../data/territories.js";
import {
  cutoffDateTime,
  deliveryDateForCycle,
  isOrderEligible,
} from "./scheduling.js";
import {
  buildTravelMatrix,
  createEstimatedTravelMatrix,
  deliveryDepartureTimestamp,
  type GeoPoint,
  type TravelMatrix,
} from "./travel-time.js";

export { cutoffDateTime, deliveryDateForCycle, isOrderEligible } from "./scheduling.js";

export function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseTime(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function formatTime(minutes: number): string {
  return formatMinutesAsTime(minutes);
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function stopPoint(stop: Stop): GeoPoint {
  return { lat: stop.lat, lng: stop.lng };
}

export function ordersToStops(orders: Order[]): Stop[] {
  const byCustomer = new Map<string, Order[]>();
  for (const order of orders) {
    const list = byCustomer.get(order.customerId) ?? [];
    list.push(order);
    byCustomer.set(order.customerId, list);
  }

  const stops: Stop[] = [];
  for (const [customerId, customerOrders] of byCustomer) {
    const customer = getCustomerById(customerId);
    if (!customer) continue;
    stops.push({
      id: `stop-${customerId}`,
      customerId,
      customerName: customer.name,
      address: customer.address,
      city: customer.city,
      territoryId: customer.territoryId,
      cycleId: customerOrders[0].cycleId,
      cases: customerOrders.reduce((s, o) => s + o.cases, 0),
      lat: customer.lat,
      lng: customer.lng,
      orderIds: customerOrders.map((o) => o.id),
      contactName: customer.contactName,
      contactPhone: customer.contactPhone,
      deliveryInstructions: customer.deliveryInstructions,
    });
  }
  return stops;
}

function nearestNeighborFrom(
  stops: Stop[],
  start: GeoPoint,
  matrix: TravelMatrix
): Stop[] {
  if (stops.length === 0) return [];
  const remaining = [...stops];
  const ordered: Stop[] = [];
  let cur = start;

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestCost = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const cost = legVehicleMinutes(cur, stopPoint(remaining[i]), matrix);
      if (cost < bestCost) {
        bestCost = cost;
        bestIdx = i;
      }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    ordered.push(next);
    cur = stopPoint(next);
  }
  return ordered;
}

function nearestNeighborOrder(stops: Stop[], depot: Depot, matrix: TravelMatrix): Stop[] {
  return nearestNeighborFrom(stops, { lat: depot.lat, lng: depot.lng }, matrix);
}

export { nearestNeighborOrder };

function routeVehicleMinutes(
  stops: Stop[],
  start: GeoPoint,
  returnToDepot: boolean,
  depot: Depot,
  matrix: TravelMatrix
): number {
  if (stops.length === 0) return 0;
  let total = stops.length * SERVICE_MINUTES_PER_STOP;
  let cur = start;
  for (const s of stops) {
    total += matrix.getDurationMinutes(cur, stopPoint(s));
    cur = stopPoint(s);
  }
  if (returnToDepot) {
    total += matrix.getDurationMinutes(cur, { lat: depot.lat, lng: depot.lng });
  }
  return total;
}

/** Marginal vehicle time to visit a stop from the current location (drive + unload). */
function legVehicleMinutes(from: GeoPoint, to: GeoPoint, matrix: TravelMatrix): number {
  return matrix.getDurationMinutes(from, to) + SERVICE_MINUTES_PER_STOP;
}

function routeDistanceMiles(
  stops: Stop[],
  start: GeoPoint,
  returnToDepot: boolean,
  depot: Depot,
  matrix: TravelMatrix
): number {
  if (stops.length === 0) return 0;
  let total = 0;
  let cur = start;
  for (const s of stops) {
    total += matrix.getDistanceMiles(cur, stopPoint(s));
    cur = stopPoint(s);
  }
  if (returnToDepot) {
    total += matrix.getDistanceMiles(cur, { lat: depot.lat, lng: depot.lng });
  }
  return total;
}

function twoOptSwap(route: Stop[], i: number, j: number): Stop[] {
  const next = route.slice(0, i);
  const reversed = route.slice(i, j + 1).reverse();
  const tail = route.slice(j + 1);
  return [...next, ...reversed, ...tail];
}

function twoOptImprove(
  route: Stop[],
  start: GeoPoint,
  returnToDepot: boolean,
  depot: Depot,
  matrix: TravelMatrix
): Stop[] {
  if (route.length < 3) return route;
  let best = [...route];
  let bestCost = routeVehicleMinutes(best, start, returnToDepot, depot, matrix);
  let improved = true;

  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const candidate = twoOptSwap(best, i, j);
        const cost = routeVehicleMinutes(candidate, start, returnToDepot, depot, matrix);
        if (cost + 0.01 < bestCost) {
          best = candidate;
          bestCost = cost;
          improved = true;
        }
      }
    }
  }
  return best;
}

/** Find stop order that minimizes total time in the delivery vehicle (drive + delivery at each stop). */
export function optimizeStopOrder(
  stops: Stop[],
  startLat: number,
  startLng: number,
  depot: Depot,
  returnToDepot: boolean,
  matrix: TravelMatrix
): Stop[] {
  if (stops.length <= 1) return [...stops];
  const start: GeoPoint = { lat: startLat, lng: startLng };

  let bestRoute = nearestNeighborFrom(stops, start, matrix);
  bestRoute = twoOptImprove(bestRoute, start, returnToDepot, depot, matrix);
  let bestCost = routeVehicleMinutes(bestRoute, start, returnToDepot, depot, matrix);

  for (const first of stops) {
    const rest = stops.filter((s) => s.id !== first.id);
    const restOrdered = nearestNeighborFrom(rest, stopPoint(first), matrix);
    let candidate = [first, ...restOrdered];
    candidate = twoOptImprove(candidate, start, returnToDepot, depot, matrix);
    const cost = routeVehicleMinutes(candidate, start, returnToDepot, depot, matrix);
    if (cost + 0.01 < bestCost) {
      bestCost = cost;
      bestRoute = candidate;
    }
  }

  return bestRoute;
}

function assignStopsToTrucks(
  stops: Stop[],
  capacity: number,
  depot: Depot,
  matrix: TravelMatrix
): Stop[][] {
  if (stops.length === 0) return [[]];

  const remaining = [...stops];
  const trucks: Stop[][] = [];

  while (remaining.length > 0) {
    const truck: Stop[] = [];
    let cases = 0;
    let cur: GeoPoint = { lat: depot.lat, lng: depot.lng };

    while (remaining.length > 0) {
      let bestIdx = -1;
      let bestCost = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const wouldExceed = cases + remaining[i].cases > capacity && truck.length > 0;
        if (wouldExceed) continue;
        const cost = legVehicleMinutes(cur, stopPoint(remaining[i]), matrix);
        if (cost < bestCost) {
          bestCost = cost;
          bestIdx = i;
        }
      }
      if (bestIdx < 0) break;
      const next = remaining.splice(bestIdx, 1)[0];
      truck.push(next);
      cases += next.cases;
      cur = stopPoint(next);
    }

    if (truck.length === 0) {
      truck.push(remaining.shift()!);
    }

    trucks.push(optimizeStopOrder(truck, depot.lat, depot.lng, depot, true, matrix));
  }

  return trucks;
}

interface LegSimulation {
  feasible: boolean;
  departureTime: number;
  completionTime: number;
  totalMiles: number;
  stopEtas: Record<string, string>;
  stopDriveMinutes: Record<string, number>;
  warnings: string[];
  errors: string[];
}

function simulateLeg(
  stopIds: string[],
  stopMap: Map<string, Stop>,
  depot: Depot,
  windowStart: string,
  windowEnd: string,
  start: GeoPoint,
  returnToDepot: boolean,
  matrix: TravelMatrix
): LegSimulation {
  const warnings: string[] = [];
  const errors: string[] = [];
  const stopEtas: Record<string, string> = {};
  const stopDriveMinutes: Record<string, number> = {};
  const winStart = parseTime(windowStart);
  const winEnd = parseTime(windowEnd);

  if (stopIds.length === 0) {
    return {
      feasible: true,
      departureTime: winStart,
      completionTime: winStart,
      totalMiles: 0,
      stopEtas,
      stopDriveMinutes,
      warnings,
      errors,
    };
  }

  const first = stopMap.get(stopIds[0])!;
  const travelToFirstMinutes = matrix.getDurationMinutes(start, stopPoint(first));
  stopDriveMinutes[stopIds[0]] = Math.round(travelToFirstMinutes);
  const departureTime = winStart - travelToFirstMinutes;

  const orderedStops = stopIds
    .map((id) => stopMap.get(id))
    .filter((s): s is Stop => !!s);

  let totalMiles = routeDistanceMiles(orderedStops, start, returnToDepot, depot, matrix);
  let t = winStart;
  stopEtas[stopIds[0]] = formatTime(winStart);
  t += SERVICE_MINUTES_PER_STOP;

  let cur = stopPoint(first);

  for (let i = 1; i < stopIds.length; i++) {
    const stopId = stopIds[i];
    const stop = stopMap.get(stopId);
    if (!stop) continue;
    const driveMinutes = matrix.getDurationMinutes(cur, stopPoint(stop));
    stopDriveMinutes[stopId] = Math.round(driveMinutes);
    t += driveMinutes;
    if (t > winEnd) {
      errors.push(`${stop.customerName}: ETA ${formatTime(t)} is after ${formatTimeOfDay(windowEnd)}`);
    } else if (t > winEnd - 30) {
      warnings.push(`${stop.customerName}: tight window (ETA ${formatTime(t)})`);
    }
    stopEtas[stopId] = formatTime(t);
    t += SERVICE_MINUTES_PER_STOP;
    cur = stopPoint(stop);
  }

  if (returnToDepot) {
    t += matrix.getDurationMinutes(cur, { lat: depot.lat, lng: depot.lng });
  }

  const driverHours = (t - departureTime) / 60;
  if (driverHours > MAX_DRIVER_HOURS) {
    errors.push(`Driver hours (${driverHours.toFixed(1)}) exceed ${MAX_DRIVER_HOURS}h limit`);
  }

  if (departureTime < 4 * 60) {
    warnings.push(`Early departure required: ${formatTime(departureTime)}`);
  }

  return {
    feasible: errors.length === 0,
    departureTime,
    completionTime: t,
    totalMiles,
    stopEtas,
    stopDriveMinutes,
    warnings,
    errors,
  };
}

export function suggestWedThreshold(
  orderedStopIds: string[],
  stopMap: Map<string, Stop>,
  depot: Depot,
  windowStart: string,
  windowEnd: string,
  matrix: TravelMatrix,
  maxDayOneDriverHours = 8
): number {
  let best = 0;
  const depotPoint = { lat: depot.lat, lng: depot.lng };
  for (let n = 1; n <= orderedStopIds.length; n++) {
    const leg = simulateLeg(
      orderedStopIds.slice(0, n),
      stopMap,
      depot,
      windowStart,
      windowEnd,
      depotPoint,
      false,
      matrix
    );
    const driverHours = (leg.completionTime - leg.departureTime) / 60;
    if (leg.feasible && driverHours <= maxDayOneDriverHours) best = n;
    else break;
  }
  return best;
}

function optimizeSegmentOrders(
  segmentGroups: Stop[][],
  depot: Depot,
  cycle: TerritoryCycle,
  matrix: TravelMatrix
): Stop[][] {
  let prevLat = depot.lat;
  let prevLng = depot.lng;

  return segmentGroups.map((group, idx) => {
    if (group.length === 0) return group;
    const isPittsburgh = cycle.multiDay;
    const startLat = idx > 0 && isPittsburgh ? prevLat : depot.lat;
    const startLng = idx > 0 && isPittsburgh ? prevLng : depot.lng;
    const returnToDepot =
      !isPittsburgh || (isPittsburgh && idx === segmentGroups.length - 1);

    const optimized = optimizeStopOrder(group, startLat, startLng, depot, returnToDepot, matrix);

    const last = optimized[optimized.length - 1];
    if (last) {
      prevLat = last.lat;
      prevLng = last.lng;
    }
    return optimized;
  });
}

function validateSegment(
  segment: Omit<Segment, "validation">,
  stopMap: Map<string, Stop>,
  depot: Depot,
  cycle: TerritoryCycle,
  matrix: TravelMatrix,
  prevEndLat?: number,
  prevEndLng?: number
): SegmentValidation {
  const stopIds = segment.stops.map((s) => s.stopId);
  const start: GeoPoint =
    segment.startLocation === "Scranton"
      ? { lat: depot.lat, lng: depot.lng }
      : { lat: prevEndLat ?? depot.lat, lng: prevEndLng ?? depot.lng };

  const leg = simulateLeg(
    stopIds,
    stopMap,
    depot,
    cycle.deliveryStart,
    cycle.deliveryEnd,
    start,
    segment.endLocation === "Scranton",
    matrix
  );

  const totalCases = stopIds.reduce((s, id) => s + (stopMap.get(id)?.cases ?? 0), 0);
  const warnings = [...leg.warnings];
  const errors = [...leg.errors];

  if (totalCases > segment.truckCapacity) {
    errors.push(
      `Segment exceeds capacity (${totalCases}/${segment.truckCapacity} cases)`
    );
  }

  return {
    departureTime: formatTime(leg.departureTime),
    completionTime: formatTime(leg.completionTime),
    totalCases,
    stopCount: stopIds.length,
    totalMiles: Math.round(leg.totalMiles * 10) / 10,
    stopDriveMinutes: leg.stopDriveMinutes,
    warnings,
    errors,
    stopEtas: leg.stopEtas,
  };
}

function resolveMatrix(
  depot: Depot,
  stops: Stop[],
  travelMatrix?: TravelMatrix
): TravelMatrix {
  return travelMatrix ?? createEstimatedTravelMatrix(depot, stops);
}

export async function buildRoutePlan(
  cycleId: string,
  orders: Order[],
  referenceDate: Date,
  existingSegmentOverrides?: StopAssignment[][],
  travelMatrix?: TravelMatrix
): Promise<{ plan: RoutePlan; matrix: TravelMatrix }> {
  const cycle = getCycleById(cycleId);
  if (!cycle) throw new Error(`Unknown cycle: ${cycleId}`);

  const eligible = orders.filter((o) => isOrderEligible(o, cycle, referenceDate));
  const stops = ordersToStops(eligible);
  const stopMap = new Map(stops.map((s) => [s.id, s]));

  const deliveryDate = deliveryDateForCycle(referenceDate, cycle);
  const batchId = `batch-${cycle.id}-${deliveryDate}`;

  const matrix =
    travelMatrix ??
    (await buildTravelMatrix(SCRANTON_DEPOT, stops, {
      departureTime: deliveryDepartureTimestamp(deliveryDate),
    }));

  let segmentGroups: Stop[][];

  if (cycle.multiDay && cycle.overflowDay) {
    const globallyOptimized = optimizeStopOrder(
      stops,
      SCRANTON_DEPOT.lat,
      SCRANTON_DEPOT.lng,
      SCRANTON_DEPOT,
      false,
      matrix
    );
    const orderedIds = globallyOptimized.map((s) => s.id);
    const threshold = suggestWedThreshold(
      orderedIds,
      stopMap,
      SCRANTON_DEPOT,
      cycle.deliveryStart,
      cycle.deliveryEnd,
      matrix
    );
    const wedCount = threshold > 0 ? threshold : Math.min(1, orderedIds.length);
    if (existingSegmentOverrides?.length === 2) {
      segmentGroups = existingSegmentOverrides.map((seg) =>
        seg.flatMap((a) => {
          const s = stopMap.get(a.stopId);
          return s ? [s] : [];
        })
      );
      segmentGroups = optimizeSegmentOrders(segmentGroups, SCRANTON_DEPOT, cycle, matrix);
    } else {
      segmentGroups = optimizeSegmentOrders(
        [globallyOptimized.slice(0, wedCount), globallyOptimized.slice(wedCount)],
        SCRANTON_DEPOT,
        cycle,
        matrix
      );
    }
  } else if (existingSegmentOverrides?.length) {
    segmentGroups = existingSegmentOverrides.map((seg) =>
      seg.flatMap((a) => {
        const s = stopMap.get(a.stopId);
        return s ? [s] : [];
      })
    );
    segmentGroups = optimizeSegmentOrders(segmentGroups, SCRANTON_DEPOT, cycle, matrix);
  } else {
    segmentGroups = assignStopsToTrucks(stops, DEFAULT_TRUCK_CAPACITY, SCRANTON_DEPOT, matrix);
  }

  const orderedIds = segmentGroups.flat().map((s) => s.id);

  const segments: Segment[] = segmentGroups.map((group, idx) => {
    const isPittsburgh = cycle.multiDay;
    let label: string;
    let segmentType: Segment["segmentType"] = "truck";
    let deliveryDateStr = deliveryDate;
    let startLocation: Segment["startLocation"] = "Scranton";
    let endLocation: Segment["endLocation"] = "Scranton";

    if (isPittsburgh) {
      segmentType = "day";
      if (idx === 0) {
        label = "Wednesday (primary)";
        endLocation = "overnight";
      } else {
        label = "Thursday (overflow)";
        deliveryDateStr = addDays(new Date(deliveryDate), 1).toISOString().slice(0, 10);
        startLocation = "overnight";
        endLocation = "Scranton";
      }
    } else {
      label = `Truck ${idx + 1}`;
    }

    const segStops: StopAssignment[] = group.map((s, pos) => ({
      stopId: s.id,
      position: pos,
    }));

    const base: Omit<Segment, "validation"> = {
      id: `${batchId}-seg-${idx}`,
      label,
      segmentType,
      sequence: idx,
      deliveryDate: deliveryDateStr,
      startLocation,
      endLocation,
      truckCapacity: DEFAULT_TRUCK_CAPACITY,
      stops: segStops,
    };

    return { ...base, validation: { stopCount: 0, totalCases: 0, totalMiles: 0, warnings: [], errors: [], stopEtas: {} } };
  });

  let prevLat = SCRANTON_DEPOT.lat;
  let prevLng = SCRANTON_DEPOT.lng;
  for (let i = 0; i < segments.length; i++) {
    const prevEnd =
      i > 0
        ? (() => {
            const prevSeg = segments[i - 1];
            const lastStopId = prevSeg.stops[prevSeg.stops.length - 1]?.stopId;
            const last = lastStopId ? stopMap.get(lastStopId) : undefined;
            return last ? { lat: last.lat, lng: last.lng } : { lat: prevLat, lng: prevLng };
          })()
        : undefined;

    segments[i].validation = validateSegment(
      segments[i],
      stopMap,
      SCRANTON_DEPOT,
      cycle,
      matrix,
      prevEnd?.lat,
      prevEnd?.lng
    );

    const lastId = segments[i].stops[segments[i].stops.length - 1]?.stopId;
    const lastStop = lastId ? stopMap.get(lastId) : undefined;
    if (lastStop) {
      prevLat = lastStop.lat;
      prevLng = lastStop.lng;
    }
  }

  const suggestedWedThreshold =
    cycle.multiDay
      ? suggestWedThreshold(
          orderedIds,
          stopMap,
          SCRANTON_DEPOT,
          cycle.deliveryStart,
          cycle.deliveryEnd,
          matrix
        )
      : undefined;

  return {
    plan: {
      id: `plan-${batchId}`,
      territoryId: cycle.territoryId,
      territoryName: cycle.name,
      cycleId: cycle.id,
      batchId,
      deliveryDate,
      depot: SCRANTON_DEPOT,
      segments,
      allStops: stops,
      suggestedWedThreshold,
      status: "draft",
      travelTimeSource: matrix.source,
    },
    matrix,
  };
}

export function applySegmentStops(
  plan: RoutePlan,
  segmentStops: { segmentId: string; stops: StopAssignment[] }[],
  travelMatrix?: TravelMatrix
): RoutePlan {
  const cycle = getCycleById(plan.cycleId);
  if (!cycle) throw new Error("Invalid cycle");

  const matrix = resolveMatrix(SCRANTON_DEPOT, plan.allStops, travelMatrix);
  const stopMap = new Map(plan.allStops.map((s) => [s.id, s]));
  const updatedSegments = plan.segments.map((seg) => {
    const override = segmentStops.find((s) => s.segmentId === seg.id);
    const stops = (override?.stops ?? seg.stops).map((s, i) => ({ ...s, position: i }));
    return { ...seg, stops };
  });

  let prevLat = SCRANTON_DEPOT.lat;
  let prevLng = SCRANTON_DEPOT.lng;
  for (let i = 0; i < updatedSegments.length; i++) {
    const prevEnd =
      i > 0
        ? (() => {
            const prevSeg = updatedSegments[i - 1];
            const lastStopId = prevSeg.stops[prevSeg.stops.length - 1]?.stopId;
            const last = lastStopId ? stopMap.get(lastStopId) : undefined;
            return last ? { lat: last.lat, lng: last.lng } : { lat: prevLat, lng: prevLng };
          })()
        : undefined;

    updatedSegments[i].validation = validateSegment(
      updatedSegments[i],
      stopMap,
      SCRANTON_DEPOT,
      cycle,
      matrix,
      prevEnd?.lat,
      prevEnd?.lng
    );

    const lastId = updatedSegments[i].stops[updatedSegments[i].stops.length - 1]?.stopId;
    const lastStop = lastId ? stopMap.get(lastId) : undefined;
    if (lastStop) {
      prevLat = lastStop.lat;
      prevLng = lastStop.lng;
    }
  }

  return { ...plan, segments: updatedSegments, travelTimeSource: matrix.source };
}

function combinedStopOrder(plan: RoutePlan): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const seg of plan.segments) {
    for (const assignment of seg.stops) {
      if (!seen.has(assignment.stopId)) {
        seen.add(assignment.stopId);
        ordered.push(assignment.stopId);
      }
    }
  }
  for (const stop of plan.allStops) {
    if (!seen.has(stop.id)) ordered.push(stop.id);
  }
  return ordered;
}

export function setWedThreshold(
  plan: RoutePlan,
  threshold: number,
  travelMatrix?: TravelMatrix
): RoutePlan {
  const cycle = getCycleById(plan.cycleId);
  if (!cycle?.multiDay) return plan;

  const matrix = resolveMatrix(SCRANTON_DEPOT, plan.allStops, travelMatrix);
  const stopMap = new Map(plan.allStops.map((s) => [s.id, s]));
  const orderedIds = combinedStopOrder(plan);
  const orderedStops = orderedIds
    .map((id) => stopMap.get(id))
    .filter((s): s is Stop => !!s);

  const n = Math.max(0, Math.min(threshold, orderedStops.length));
  const seg0 = plan.segments[0];
  const seg1 = plan.segments[1];
  if (!seg0 || !seg1) return plan;

  const groups = optimizeSegmentOrders(
    [orderedStops.slice(0, n), orderedStops.slice(n)],
    SCRANTON_DEPOT,
    cycle,
    matrix
  );

  return applySegmentStops(
    plan,
    [
      {
        segmentId: seg0.id,
        stops: groups[0].map((s, i) => ({ stopId: s.id, position: i })),
      },
      {
        segmentId: seg1.id,
        stops: groups[1].map((s, i) => ({ stopId: s.id, position: i })),
      },
    ],
    matrix
  );
}

export function moveStopBetweenSegments(
  plan: RoutePlan,
  stopId: string,
  fromSegmentId: string,
  toSegmentId: string,
  toIndex: number,
  travelMatrix?: TravelMatrix
): RoutePlan {
  const segmentStops = plan.segments.map((seg) => ({
    segmentId: seg.id,
    stops: seg.stops.filter((s) => s.stopId !== stopId).map((s, i) => ({ ...s, position: i })),
  }));

  const target = segmentStops.find((s) => s.segmentId === toSegmentId);
  if (!target) return plan;

  const newStops = [...target.stops];
  newStops.splice(toIndex, 0, { stopId, position: toIndex });
  target.stops = newStops.map((s, i) => ({ ...s, position: i }));

  return applySegmentStops(plan, segmentStops, travelMatrix);
}

export function reorderStopInSegment(
  plan: RoutePlan,
  segmentId: string,
  stopId: string,
  newIndex: number,
  travelMatrix?: TravelMatrix
): RoutePlan {
  const segmentStops = plan.segments.map((seg) => {
    if (seg.id !== segmentId) return { segmentId: seg.id, stops: [...seg.stops] };
    const stops = seg.stops.filter((s) => s.stopId !== stopId);
    stops.splice(newIndex, 0, { stopId, position: newIndex });
    return {
      segmentId: seg.id,
      stops: stops.map((s, i) => ({ ...s, position: i })),
    };
  });
  return applySegmentStops(plan, segmentStops, travelMatrix);
}

export function appendTruckSegment(
  plan: RoutePlan,
  travelMatrix?: TravelMatrix
): RoutePlan {
  const cycle = getCycleById(plan.cycleId);
  if (!cycle || cycle.multiDay) return plan;

  const idx = plan.segments.length;
  const newSeg: Segment = {
    id: `${plan.batchId}-seg-${idx}`,
    label: `Truck ${idx + 1}`,
    segmentType: "truck",
    sequence: idx,
    deliveryDate: plan.deliveryDate,
    startLocation: "Scranton",
    endLocation: "Scranton",
    truckCapacity: DEFAULT_TRUCK_CAPACITY,
    stops: [],
    validation: {
      stopCount: 0,
      totalCases: 0,
      totalMiles: 0,
      warnings: [],
      errors: [],
      stopEtas: {},
    },
  };

  const combined = [...plan.segments, newSeg];
  return applySegmentStops(
    { ...plan, segments: combined },
    combined.map((s) => ({ segmentId: s.id, stops: s.stops })),
    travelMatrix
  );
}

export function getUnassignedStopIds(plan: RoutePlan): string[] {
  const assigned = new Set(plan.segments.flatMap((s) => s.stops.map((st) => st.stopId)));
  return plan.allStops.filter((s) => !assigned.has(s.id)).map((s) => s.id);
}

export function allStopsAssigned(plan: RoutePlan): boolean {
  return getUnassignedStopIds(plan).length === 0;
}
