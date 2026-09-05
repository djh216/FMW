import "dotenv/config";
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { TERRITORY_CYCLES } from "./data/territories.js";
import {
  applyOrderSelection,
  addManualOrder,
  addStopToRoute,
  clearOrdersForCycle,
  getAvailableCustomersForCycle,
  getCustomerListItems,
  getOrders,
  getUploadSummary,
  importWeeklyCustomersCsv,
  clearCustomerData,
  removeOrderForCustomer,
} from "./data/customer-store.js";
import { uniqueTerritories } from "./data/territories.js";
import {
  applySegmentStops,
  appendTruckSegment,
  buildRoutePlan,
  reorderStopInSegment,
  setWedThreshold,
} from "./routing/planner.js";
import { buildRouteGeometry, clearRouteGeometryCache } from "./routing/route-geometry.js";
import {
  cutoffDateTime,
  deliveryDateForCycle,
  isOrderEligible,
} from "./routing/scheduling.js";
import {
  clearTravelTimeCache,
  createEstimatedTravelMatrix,
  type TravelMatrix,
} from "./routing/travel-time.js";
import type { ManualOrderInput, OrderSelectionInput, RoutePlan, StopAssignment } from "../shared/types.js";
import { SCRANTON_DEPOT } from "../shared/constants.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

const REFERENCE_DATE = new Date("2026-09-10T12:00:00");
const routePlans = new Map<string, RoutePlan>();
const travelMatrices = new Map<string, TravelMatrix>();

function clearRoutePlans() {
  routePlans.clear();
  travelMatrices.clear();
  clearTravelTimeCache();
  clearRouteGeometryCache();
}

function invalidateRoutePlan(cycleId: string) {
  routePlans.delete(cycleId);
  travelMatrices.delete(cycleId);
  clearTravelTimeCache();
  clearRouteGeometryCache();
}

function getMatrixForCycle(cycleId: string, plan: RoutePlan): TravelMatrix {
  return (
    travelMatrices.get(cycleId) ??
    createEstimatedTravelMatrix(SCRANTON_DEPOT, plan.allStops)
  );
}

async function getOrCreatePlan(cycleId: string): Promise<RoutePlan> {
  const cached = routePlans.get(cycleId);
  if (cached) return cached;
  return buildAndCachePlan(cycleId);
}

async function buildAndCachePlan(cycleId: string): Promise<RoutePlan> {
  const { plan, matrix } = await buildRoutePlan(cycleId, getOrders(), REFERENCE_DATE);
  routePlans.set(cycleId, plan);
  travelMatrices.set(cycleId, matrix);
  return plan;
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    depot: SCRANTON_DEPOT,
    googleMapsConfigured: !!process.env.GOOGLE_MAPS_API_KEY,
  });
});

app.get("/api/territories", (_req, res) => {
  res.json(uniqueTerritories());
});

app.get("/api/territories/cycles", (_req, res) => {
  res.json(TERRITORY_CYCLES);
});

app.get("/api/customers", (_req, res) => {
  res.json(getCustomerListItems());
});

app.get("/api/customers/status", (_req, res) => {
  res.json(getUploadSummary());
});

app.post("/api/customers/upload", express.text({ type: ["text/csv", "text/plain", "*/*"], limit: "5mb" }), async (req, res) => {
  const csvText = typeof req.body === "string" ? req.body : "";
  const filename = (req.query.filename as string) || undefined;
  try {
    const summary = await importWeeklyCustomersCsv(csvText, REFERENCE_DATE, filename);
    if (summary.errors.length === 0) clearRoutePlans();
    res.status(summary.errors.length > 0 ? 400 : 200).json(summary);
  } catch (e) {
    res.status(500).json({
      uploadedAt: new Date().toISOString(),
      customerCount: 0,
      orderCount: 0,
      filename,
      errors: [e instanceof Error ? e.message : "Upload failed"],
      warnings: [],
    });
  }
});

app.post("/api/customers/reset", (_req, res) => {
  const summary = clearCustomerData();
  clearRoutePlans();
  res.json(summary);
});

app.post("/api/customers/manual", async (req, res) => {
  const input = req.body as ManualOrderInput;
  try {
    const summary = await addManualOrder(input, REFERENCE_DATE);
    if (summary.errors.length === 0) clearRoutePlans();
    res.status(summary.errors.length > 0 ? 400 : 200).json(summary);
  } catch (e) {
    res.status(500).json({
      uploadedAt: new Date().toISOString(),
      customerCount: 0,
      orderCount: 0,
      errors: [e instanceof Error ? e.message : "Failed to add order"],
      warnings: [],
    });
  }
});

app.post("/api/orders/selection", (req, res) => {
  const { selections } = req.body as { selections: OrderSelectionInput[] };
  const summary = applyOrderSelection(selections ?? [], REFERENCE_DATE);
  if (summary.errors.length === 0) clearRoutePlans();
  res.status(summary.errors.length > 0 ? 400 : 200).json(summary);
});

app.delete("/api/orders/customer/:customerId", async (req, res) => {
  const existing = getOrders().find((o) => o.customerId === req.params.customerId);
  const summary = removeOrderForCustomer(req.params.customerId, REFERENCE_DATE);
  if (summary.errors.length === 0) {
    if (existing) invalidateRoutePlan(existing.cycleId);
    else clearRoutePlans();
  }
  res.status(summary.errors.length > 0 ? 400 : 200).json(summary);
});

app.delete("/api/routes/:cycleId/orders", async (req, res) => {
  const summary = clearOrdersForCycle(req.params.cycleId, REFERENCE_DATE);
  if (summary.errors.length === 0) invalidateRoutePlan(req.params.cycleId);
  res.status(summary.errors.length > 0 ? 400 : 200).json(summary);
});

app.get("/api/routes/:cycleId/available-customers", (req, res) => {
  res.json(getAvailableCustomersForCycle(req.params.cycleId));
});

app.post("/api/routes/:cycleId/add-stop", async (req, res) => {
  try {
    const result = await addStopToRoute(req.params.cycleId, req.body, REFERENCE_DATE);
    if (result.errors.length > 0) {
      res.status(400).json(result);
      return;
    }
    invalidateRoutePlan(req.params.cycleId);
    const plan = await buildAndCachePlan(req.params.cycleId);
    res.json({ ...result, plan });
  } catch (e) {
    res.status(500).json({
      summary: {
        uploadedAt: new Date().toISOString(),
        customerCount: 0,
        orderCount: 0,
        errors: [e instanceof Error ? e.message : "Failed to add stop"],
        warnings: [],
      },
      errors: [e instanceof Error ? e.message : "Failed to add stop"],
      warnings: [],
    });
  }
});

app.get("/api/batches", (_req, res) => {
  const orders = getOrders();
  const batches = TERRITORY_CYCLES.map((cycle) => {
    const eligible = orders.filter((o) => isOrderEligible(o, cycle, REFERENCE_DATE));
    const cases = eligible.reduce((s, o) => s + o.cases, 0);
    const customers = new Set(eligible.map((o) => o.customerId));
    return {
      cycleId: cycle.id,
      territoryId: cycle.territoryId,
      territoryName: cycle.name,
      cutoffAt: cutoffDateTime(REFERENCE_DATE, cycle).toISOString(),
      deliveryDate: deliveryDateForCycle(REFERENCE_DATE, cycle),
      orderCount: eligible.length,
      stopCount: customers.size,
      totalCases: cases,
      multiDay: cycle.multiDay,
    };
  }).filter((b) => b.orderCount > 0);

  res.json(batches);
});

app.get("/api/routes/:cycleId", async (req, res) => {
  try {
    const plan = await getOrCreatePlan(req.params.cycleId);
    res.json(plan);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to build route" });
  }
});

app.post("/api/routes/:cycleId/segments", async (req, res) => {
  try {
    const plan = await getOrCreatePlan(req.params.cycleId);
    const matrix = getMatrixForCycle(req.params.cycleId, plan);
    const { segments } = req.body as { segments: { segmentId: string; stops: StopAssignment[] }[] };
    const updated = applySegmentStops(plan, segments, matrix);
    routePlans.set(req.params.cycleId, updated);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to update segments" });
  }
});

app.post("/api/routes/:cycleId/wed-threshold", async (req, res) => {
  try {
    const plan = await getOrCreatePlan(req.params.cycleId);
    const matrix = getMatrixForCycle(req.params.cycleId, plan);
    const { threshold } = req.body as { threshold: number };
    const updated = setWedThreshold(plan, threshold, matrix);
    routePlans.set(req.params.cycleId, updated);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to set threshold" });
  }
});

app.post("/api/routes/:cycleId/reorder", async (req, res) => {
  try {
    const plan = await getOrCreatePlan(req.params.cycleId);
    const matrix = getMatrixForCycle(req.params.cycleId, plan);
    const { segmentId, stopId, newIndex } = req.body as {
      segmentId: string;
      stopId: string;
      newIndex: number;
    };
    const updated = reorderStopInSegment(plan, segmentId, stopId, newIndex, matrix);
    routePlans.set(req.params.cycleId, updated);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to reorder stop" });
  }
});

app.post("/api/routes/:cycleId/add-truck", async (req, res) => {
  try {
    const plan = await getOrCreatePlan(req.params.cycleId);
    const matrix = getMatrixForCycle(req.params.cycleId, plan);
    const updated = appendTruckSegment(plan, matrix);
    routePlans.set(req.params.cycleId, updated);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to add truck" });
  }
});

app.post("/api/routes/:cycleId/lock", async (req, res) => {
  try {
    const plan = await getOrCreatePlan(req.params.cycleId);
    const updated = { ...plan, status: "locked" as const };
    routePlans.set(req.params.cycleId, updated);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to lock route" });
  }
});

app.post("/api/routes/:cycleId/unlock", async (req, res) => {
  try {
    const plan = await getOrCreatePlan(req.params.cycleId);
    if (plan.status !== "locked") {
      res.json(plan);
      return;
    }
    const updated = { ...plan, status: "draft" as const };
    routePlans.set(req.params.cycleId, updated);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to unlock route" });
  }
});

app.post("/api/routes/:cycleId/reset", async (req, res) => {
  try {
    const plan = await buildAndCachePlan(req.params.cycleId);
    res.json(plan);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to reset route" });
  }
});

app.post("/api/routes/:cycleId/geometry", async (req, res) => {
  try {
    const plan = await getOrCreatePlan(req.params.cycleId);
    const { segments } = req.body as {
      segments?: { segmentId: string; stops: StopAssignment[] }[];
    };
    const geometry = await buildRouteGeometry(plan, segments ?? null);
    res.json(geometry);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to build route geometry" });
  }
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.join(__dirname, "../client/dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => {
  console.log(`Wine routing API on http://localhost:${PORT}`);
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    console.warn("GOOGLE_MAPS_API_KEY not set — using straight-line drive time and map routes");
  }
});
