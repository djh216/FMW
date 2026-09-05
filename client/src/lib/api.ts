import type { BatchSummary, CustomerListItem, CustomerUploadSummary, OrderSelectionInput, RoutePlan } from "@shared/types";

const API = "/api";

export async function fetchBatches(): Promise<BatchSummary[]> {
  const res = await fetch(`${API}/batches`);
  if (!res.ok) throw new Error("Failed to load batches");
  return res.json();
}

export async function fetchUploadStatus(): Promise<CustomerUploadSummary | null> {
  const res = await fetch(`${API}/customers/status`);
  if (!res.ok) throw new Error("Failed to load upload status");
  return res.json();
}

export async function uploadCustomersCsv(csvText: string, filename: string): Promise<CustomerUploadSummary> {
  const res = await fetch(`${API}/customers/upload?filename=${encodeURIComponent(filename)}`, {
    method: "POST",
    headers: { "Content-Type": "text/csv" },
    body: csvText,
  });
  const data = (await res.json()) as CustomerUploadSummary;
  if (!res.ok) return data;
  return data;
}

export async function resetCustomers(): Promise<CustomerUploadSummary> {
  const res = await fetch(`${API}/customers/reset`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to reset customers");
  return res.json();
}

export async function fetchCustomerList(): Promise<CustomerListItem[]> {
  const res = await fetch(`${API}/customers`);
  if (!res.ok) throw new Error("Failed to load customers");
  return res.json();
}

export async function applyOrderSelection(
  selections: OrderSelectionInput[]
): Promise<CustomerUploadSummary> {
  const res = await fetch(`${API}/orders/selection`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ selections }),
  });
  const data = (await res.json()) as CustomerUploadSummary;
  if (!res.ok && data.errors?.length) return data;
  if (!res.ok) throw new Error("Failed to apply order selection");
  return data;
}

export function downloadCustomerTemplate() {
  window.open(`${API}/customers/template.csv`, "_blank");
}

export async function fetchRoutePlan(cycleId: string): Promise<RoutePlan> {
  const res = await fetch(`${API}/routes/${cycleId}`);
  if (!res.ok) throw new Error("Failed to load route plan");
  return res.json();
}

export async function updateSegments(
  cycleId: string,
  segments: { segmentId: string; stops: { stopId: string; position: number }[] }[]
): Promise<RoutePlan> {
  const res = await fetch(`${API}/routes/${cycleId}/segments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ segments }),
  });
  if (!res.ok) throw new Error("Failed to update segments");
  return res.json();
}

export async function setWedThreshold(cycleId: string, threshold: number): Promise<RoutePlan> {
  const res = await fetch(`${API}/routes/${cycleId}/wed-threshold`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ threshold }),
  });
  if (!res.ok) throw new Error("Failed to set threshold");
  return res.json();
}

export async function addTruck(cycleId: string): Promise<RoutePlan> {
  const res = await fetch(`${API}/routes/${cycleId}/add-truck`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to add truck");
  return res.json();
}

export async function resetRoute(cycleId: string): Promise<RoutePlan> {
  const res = await fetch(`${API}/routes/${cycleId}/reset`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to reset route");
  return res.json();
}

export async function unlockRoute(cycleId: string): Promise<RoutePlan> {
  const res = await fetch(`${API}/routes/${cycleId}/unlock`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to unlock route");
  return res.json();
}

export async function lockRoute(cycleId: string): Promise<RoutePlan> {
  const res = await fetch(`${API}/routes/${cycleId}/lock`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to lock route");
  return res.json();
}

export interface RouteGeometrySegment {
  segmentId: string;
  path: { lat: number; lng: number }[];
}

export interface RouteGeometryResponse {
  source: "google" | "estimated";
  segments: RouteGeometrySegment[];
}

export async function fetchRouteGeometry(
  cycleId: string,
  body?: { segments: { segmentId: string; stops: { stopId: string; position: number }[] }[] },
  signal?: AbortSignal
): Promise<RouteGeometryResponse> {
  const res = await fetch(`${API}/routes/${cycleId}/geometry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal,
  });
  if (!res.ok) throw new Error("Failed to load route geometry");
  return res.json();
}
