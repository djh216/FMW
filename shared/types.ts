export type DayOfWeek =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export type SegmentType = "day" | "truck";

export type RoutePlanStatus = "draft" | "locked";

export interface Depot {
  name: string;
  address: string;
  city: string;
  lat: number;
  lng: number;
}

export interface TerritoryCycle {
  id: string;
  territoryId: string;
  name: string;
  cutoffDay: DayOfWeek;
  cutoffTime: string;
  deliveryDay: DayOfWeek;
  deliveryStart: string;
  deliveryEnd: string;
  cycle: number;
  multiDay: boolean;
  overflowDay?: DayOfWeek;
  noReturnBetweenDays?: boolean;
}

export interface Customer {
  id: string;
  name: string;
  address: string;
  city: string;
  territoryId: string;
  lat: number;
  lng: number;
  contactName: string;
  contactPhone: string;
  deliveryInstructions: string;
}

export interface CustomerUploadSummary {
  uploadedAt: string;
  customerCount: number;
  orderCount: number;
  filename?: string;
  errors: string[];
  warnings: string[];
  /** True when customers are loaded but orders must be selected manually */
  awaitingOrderSelection?: boolean;
  /** True when the active customer list came from a CSV upload */
  fromCsvUpload?: boolean;
}

/** Customer row for order selection UI */
export interface CustomerListItem extends Customer {
  territoryName: string;
  hasOrder: boolean;
  cases: number;
  /** Philadelphia only: 1 = Wed run, 2 = Thu run */
  cycle?: number;
}

export interface OrderSelectionInput {
  customerId: string;
  cases: number;
  cycle?: number;
}

/** Manual order entry — same fields as weekly CSV rows */
export interface ManualOrderInput {
  restaurantName: string;
  address: string;
  city: string;
  contactName: string;
  contactPhone: string;
  deliveryInstructions: string;
  territoryId: string;
  /** Philadelphia only: 1 = Wed run, 2 = Thu run */
  cycle?: number;
}

/** Add an existing account or new manual entry to a specific route cycle */
export type AddStopInput =
  | ManualOrderInput
  | { customerId: string };

export interface AddStopResult {
  summary: CustomerUploadSummary;
  errors: string[];
  warnings: string[];
}

export interface Order {
  id: string;
  customerId: string;
  territoryId: string;
  cycleId: string;
  cases: number;
  approvedAt: string;
  status: "approved" | "batched" | "delivered";
}

export interface Stop {
  id: string;
  customerId: string;
  customerName: string;
  address: string;
  city: string;
  territoryId: string;
  cycleId: string;
  cases: number;
  lat: number;
  lng: number;
  orderIds: string[];
  contactName: string;
  contactPhone: string;
  deliveryInstructions: string;
}

export interface StopAssignment {
  stopId: string;
  position: number;
}

export interface SegmentValidation {
  departureTime?: string;
  completionTime?: string;
  totalCases: number;
  stopCount: number;
  totalMiles: number;
  /** Total driving minutes (depot/start → stops → return if applicable) */
  totalDriveMinutes?: number;
  /** Total minutes from departure through last stop/return (drive + service) */
  totalRouteMinutes?: number;
  /** Google Maps (or estimated) drive minutes from previous location to each stop */
  stopDriveMinutes?: Record<string, number>;
  warnings: string[];
  errors: string[];
  stopEtas: Record<string, string>;
}

export interface Segment {
  id: string;
  label: string;
  segmentType: SegmentType;
  sequence: number;
  deliveryDate: string;
  startLocation: "Scranton" | "overnight" | "previous_stop";
  endLocation: "Scranton" | "overnight" | "last_stop";
  truckCapacity: number;
  stops: StopAssignment[];
  validation: SegmentValidation;
}

export interface RoutePlan {
  id: string;
  territoryId: string;
  territoryName: string;
  cycleId: string;
  batchId: string;
  deliveryDate: string;
  depot: Depot;
  segments: Segment[];
  allStops: Stop[];
  suggestedWedThreshold?: number;
  status: RoutePlanStatus;
  /** Whether drive times came from Google Maps or straight-line estimates */
  travelTimeSource?: "google" | "estimated";
}

export interface BatchSummary {
  id: string;
  cycleId: string;
  territoryId: string;
  territoryName: string;
  cutoffAt: string;
  deliveryDate: string;
  orderCount: number;
  stopCount: number;
  totalCases: number;
  multiDay?: boolean;
  routePlanId?: string;
}
