import { AVERAGE_MPH, SCRANTON_DEPOT } from "../../shared/constants.js";
import type { Depot, Stop } from "../../shared/types.js";

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface LegMetrics {
  durationMinutes: number;
  distanceMeters: number;
}

export type TravelTimeSource = "google" | "estimated";

export interface TravelMatrix {
  source: TravelTimeSource;
  getLeg(from: GeoPoint, to: GeoPoint): LegMetrics;
  getDurationMinutes(from: GeoPoint, to: GeoPoint): number;
  getDistanceMiles(from: GeoPoint, to: GeoPoint): number;
}

const globalLegCache = new Map<string, LegMetrics>();

function legKey(from: GeoPoint, to: GeoPoint): string {
  return `${from.lat.toFixed(5)},${from.lng.toFixed(5)}->${to.lat.toFixed(5)},${to.lng.toFixed(5)}`;
}

function samePoint(a: GeoPoint, b: GeoPoint): boolean {
  return a.lat.toFixed(5) === b.lat.toFixed(5) && a.lng.toFixed(5) === b.lng.toFixed(5);
}

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateLeg(from: GeoPoint, to: GeoPoint): LegMetrics {
  const cached = globalLegCache.get(legKey(from, to));
  if (cached) return cached;

  const distanceMeters = haversineMeters(from.lat, from.lng, to.lat, to.lng);
  const durationMinutes = (distanceMeters / 1609.344 / AVERAGE_MPH) * 60;
  const metrics = { durationMinutes, distanceMeters };
  globalLegCache.set(legKey(from, to), metrics);
  return metrics;
}

class TravelMatrixImpl implements TravelMatrix {
  constructor(
    readonly source: TravelTimeSource,
    private readonly legs: Map<string, LegMetrics>
  ) {}

  getLeg(from: GeoPoint, to: GeoPoint): LegMetrics {
    if (samePoint(from, to)) return { durationMinutes: 0, distanceMeters: 0 };
    return this.legs.get(legKey(from, to)) ?? estimateLeg(from, to);
  }

  getDurationMinutes(from: GeoPoint, to: GeoPoint): number {
    return this.getLeg(from, to).durationMinutes;
  }

  getDistanceMiles(from: GeoPoint, to: GeoPoint): number {
    return this.getLeg(from, to).distanceMeters / 1609.344;
  }
}

function uniquePoints(depot: Depot, stops: Stop[]): GeoPoint[] {
  const points: GeoPoint[] = [{ lat: depot.lat, lng: depot.lng }];
  const seen = new Set<string>([`${depot.lat.toFixed(5)},${depot.lng.toFixed(5)}`]);

  for (const stop of stops) {
    const key = `${stop.lat.toFixed(5)},${stop.lng.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    points.push({ lat: stop.lat, lng: stop.lng });
  }
  return points;
}

/** Straight-line estimate matrix (tests / fallback when Google is unavailable). */
export function createEstimatedTravelMatrix(depot: Depot, stops: Stop[]): TravelMatrix {
  const legs = new Map<string, LegMetrics>();
  const points = uniquePoints(depot, stops);

  for (const from of points) {
    for (const to of points) {
      if (samePoint(from, to)) continue;
      const metrics = estimateLeg(from, to);
      legs.set(legKey(from, to), metrics);
    }
  }

  return new TravelMatrixImpl("estimated", legs);
}

const BATCH_SIZE = 10;
const REQUEST_DELAY_MS = 120;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface GoogleMatrixResponse {
  rows?: {
    elements?: {
      status: string;
      duration?: { value: number };
      distance?: { value: number };
    }[];
  }[];
  status: string;
  error_message?: string;
}

async function fetchGoogleMatrixBatch(
  origins: GeoPoint[],
  destinations: GeoPoint[],
  apiKey: string,
  departureTime?: number
): Promise<Map<string, LegMetrics>> {
  const params = new URLSearchParams({
    origins: origins.map((p) => `${p.lat},${p.lng}`).join("|"),
    destinations: destinations.map((p) => `${p.lat},${p.lng}`).join("|"),
    mode: "driving",
    units: "imperial",
    key: apiKey,
  });

  if (departureTime && departureTime > Math.floor(Date.now() / 1000)) {
    params.set("departure_time", String(departureTime));
    params.set("traffic_model", "best_guess");
  }

  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?${params}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Google Distance Matrix HTTP ${res.status}`);
  }

  const data = (await res.json()) as GoogleMatrixResponse;
  if (data.status !== "OK") {
    throw new Error(data.error_message ?? `Google Distance Matrix: ${data.status}`);
  }

  const legs = new Map<string, LegMetrics>();
  for (let i = 0; i < origins.length; i++) {
    const row = data.rows?.[i]?.elements ?? [];
    for (let j = 0; j < destinations.length; j++) {
      const element = row[j];
      if (!element || element.status !== "OK" || !element.duration || !element.distance) {
        continue;
      }
      const from = origins[i];
      const to = destinations[j];
      const metrics = {
        durationMinutes: element.duration.value / 60,
        distanceMeters: element.distance.value,
      };
      legs.set(legKey(from, to), metrics);
      globalLegCache.set(legKey(from, to), metrics);
    }
  }

  return legs;
}

export function deliveryDepartureTimestamp(deliveryDate: string, hour = 10): number {
  const [y, m, d] = deliveryDate.split("-").map(Number);
  // Eastern Time — EDT in routing season (Mar–Nov). Good enough for traffic estimates.
  const offset = "-04:00";
  const local = new Date(`${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00${offset}`);
  return Math.floor(local.getTime() / 1000);
}

export async function buildTravelMatrix(
  depot: Depot,
  stops: Stop[],
  options?: { departureTime?: number; apiKey?: string }
): Promise<TravelMatrix> {
  const apiKey = options?.apiKey ?? process.env.GOOGLE_MAPS_API_KEY;
  const points = uniquePoints(depot, stops);

  if (!apiKey || points.length <= 1) {
    return createEstimatedTravelMatrix(depot, stops);
  }

  const legs = new Map<string, LegMetrics>();

  try {
    for (let i = 0; i < points.length; i += BATCH_SIZE) {
      for (let j = 0; j < points.length; j += BATCH_SIZE) {
        const origins = points.slice(i, i + BATCH_SIZE);
        const destinations = points.slice(j, j + BATCH_SIZE);
        const batch = await fetchGoogleMatrixBatch(
          origins,
          destinations,
          apiKey,
          options?.departureTime
        );
        for (const [key, value] of batch) {
          legs.set(key, value);
        }
        if (i + BATCH_SIZE < points.length || j + BATCH_SIZE < points.length) {
          await sleep(REQUEST_DELAY_MS);
        }
      }
    }
  } catch (err) {
    console.warn("Google travel times unavailable, using estimates:", err);
    return createEstimatedTravelMatrix(depot, stops);
  }

  // Fill any missing pairs with straight-line estimates.
  for (const from of points) {
    for (const to of points) {
      if (samePoint(from, to)) continue;
      const key = legKey(from, to);
      if (!legs.has(key)) {
        legs.set(key, estimateLeg(from, to));
      }
    }
  }

  return new TravelMatrixImpl("google", legs);
}

export function clearTravelTimeCache(): void {
  globalLegCache.clear();
}

export { SCRANTON_DEPOT };
