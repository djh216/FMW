import type { TerritoryCycle } from "../../shared/types.js";

/** Territory schedules from Territories and Delivery.xlsx */
export const TERRITORY_CYCLES: TerritoryCycle[] = [
  {
    id: "philadelphia-1",
    territoryId: "philadelphia",
    name: "Philadelphia",
    cutoffDay: "tuesday",
    cutoffTime: "14:30",
    deliveryDay: "wednesday",
    deliveryStart: "10:00",
    deliveryEnd: "16:00",
    cycle: 1,
    multiDay: false,
  },
  {
    id: "philadelphia-2",
    territoryId: "philadelphia",
    name: "Philadelphia",
    cutoffDay: "wednesday",
    cutoffTime: "14:30",
    deliveryDay: "thursday",
    deliveryStart: "10:00",
    deliveryEnd: "16:00",
    cycle: 2,
    multiDay: false,
  },
  {
    id: "western-philly",
    territoryId: "western-philly",
    name: "Western Philly Suburbs",
    cutoffDay: "tuesday",
    cutoffTime: "14:30",
    deliveryDay: "wednesday",
    deliveryStart: "10:00",
    deliveryEnd: "16:00",
    cycle: 1,
    multiDay: false,
  },
  {
    id: "southern-susquehanna",
    territoryId: "southern-susquehanna",
    name: "Southern Susquehanna Valley",
    cutoffDay: "tuesday",
    cutoffTime: "14:30",
    deliveryDay: "wednesday",
    deliveryStart: "10:00",
    deliveryEnd: "16:00",
    cycle: 1,
    multiDay: false,
  },
  {
    id: "pittsburgh",
    territoryId: "pittsburgh",
    name: "Pittsburgh",
    cutoffDay: "tuesday",
    cutoffTime: "14:30",
    deliveryDay: "wednesday",
    deliveryStart: "10:00",
    deliveryEnd: "16:00",
    cycle: 1,
    multiDay: true,
    overflowDay: "thursday",
    noReturnBetweenDays: true,
  },
  {
    id: "northern-philly",
    territoryId: "northern-philly",
    name: "Northern Philly Suburbs",
    cutoffDay: "wednesday",
    cutoffTime: "14:30",
    deliveryDay: "thursday",
    deliveryStart: "10:00",
    deliveryEnd: "16:00",
    cycle: 1,
    multiDay: false,
  },
  {
    id: "northeast-pa",
    territoryId: "northeast-pa",
    name: "Northeast PA",
    cutoffDay: "thursday",
    cutoffTime: "14:30",
    deliveryDay: "friday",
    deliveryStart: "10:00",
    deliveryEnd: "16:00",
    cycle: 1,
    multiDay: false,
  },
  {
    id: "lehigh-valley",
    territoryId: "lehigh-valley",
    name: "Lehigh Valley",
    cutoffDay: "thursday",
    cutoffTime: "14:30",
    deliveryDay: "friday",
    deliveryStart: "10:00",
    deliveryEnd: "16:00",
    cycle: 1,
    multiDay: false,
  },
  {
    id: "northern-susquehanna",
    territoryId: "northern-susquehanna",
    name: "Northern Susquehanna Valley",
    cutoffDay: "thursday",
    cutoffTime: "14:30",
    deliveryDay: "friday",
    deliveryStart: "10:00",
    deliveryEnd: "16:00",
    cycle: 1,
    multiDay: false,
  },
];

export function getCycleById(id: string): TerritoryCycle | undefined {
  return TERRITORY_CYCLES.find((c) => c.id === id);
}

export function getCyclesForTerritory(territoryId: string): TerritoryCycle[] {
  return TERRITORY_CYCLES.filter((c) => c.territoryId === territoryId);
}

export function getTerritoryDisplayName(territoryId: string): string {
  return getCyclesForTerritory(territoryId)[0]?.name ?? territoryId;
}

export function resolveCycleId(territoryId: string, cycleRaw?: string | number): string {
  const cycles = getCyclesForTerritory(territoryId).sort((a, b) => a.cycle - b.cycle);
  if (cycles.length === 0) throw new Error(`No cycles for territory ${territoryId}`);
  if (cycleRaw === undefined || cycleRaw === "") return cycles[0].id;
  const n = typeof cycleRaw === "number" ? cycleRaw : Number(cycleRaw);
  if (!Number.isNaN(n)) {
    const match = cycles.find((c) => c.cycle === n);
    if (match) return match.id;
  }
  const byId = cycles.find((c) => c.id === String(cycleRaw).trim());
  return byId?.id ?? cycles[0].id;
}

export function cycleNumberFromId(cycleId: string): number {
  return TERRITORY_CYCLES.find((c) => c.id === cycleId)?.cycle ?? 1;
}
