import { useCallback, useEffect, useState } from "react";
import CustomerUpload from "./components/CustomerUpload";
import OrderSelector from "./components/OrderSelector";
import RoutePrintSheet from "./components/RoutePrintSheet";
import RouteView from "./components/RouteView";
import {
  addTruck,
  fetchBatches,
  fetchRoutePlan,
  lockRoute,
  resetRoute,
  unlockRoute,
  setWedThreshold,
  updateSegments,
} from "./lib/api";
import { printRoutePdf } from "./lib/printRoute";
import { applySegmentUpdates, type SegmentUpdate } from "./lib/segmentDrag";
import { formatDateTime } from "@shared/timeFormat";
import type { BatchSummary, RoutePlan } from "@shared/types";

export default function App() {
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);
  const [plan, setPlan] = useState<RoutePlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orderListKey, setOrderListKey] = useState(0);
  const [previewSegments, setPreviewSegments] = useState<SegmentUpdate[] | null>(null);
  const [activeStopId, setActiveStopId] = useState<string | null>(null);

  const loadBatches = useCallback(() => {
    return fetchBatches().then((b) => {
      setBatches(b);
      setSelectedCycleId((prev) =>
        prev && b.some((x) => x.cycleId === prev) ? prev : (b[0]?.cycleId ?? null)
      );
    });
  }, []);

  useEffect(() => {
    loadBatches()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [loadBatches]);

  useEffect(() => {
    if (!selectedCycleId) {
      setPlan(null);
      setPreviewSegments(null);
      setActiveStopId(null);
      return;
    }
    setLoading(true);
    fetchRoutePlan(selectedCycleId)
      .then(setPlan)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [selectedCycleId]);

  const handleUpdate = useCallback(
    async (segments: SegmentUpdate[]) => {
      if (!selectedCycleId) return;
      setPreviewSegments(null);
      setPlan((current) => (current ? applySegmentUpdates(current, segments) : current));
      try {
        const updated = await updateSegments(selectedCycleId, segments);
        setPlan(updated);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to update route");
        const restored = await fetchRoutePlan(selectedCycleId);
        setPlan(restored);
      }
    },
    [selectedCycleId]
  );

  const handleWedThreshold = useCallback(
    async (n: number) => {
      if (!selectedCycleId) return;
      const updated = await setWedThreshold(selectedCycleId, n);
      setPlan(updated);
    },
    [selectedCycleId]
  );

  const handleAddTruck = useCallback(async () => {
    if (!selectedCycleId) return;
    const updated = await addTruck(selectedCycleId);
    setPlan(updated);
  }, [selectedCycleId]);

  const handleCustomersLoaded = useCallback(() => {
    setOrderListKey((k) => k + 1);
  }, []);

  const handleOrdersApplied = useCallback(async () => {
    await loadBatches();
    setOrderListKey((k) => k + 1);
  }, [loadBatches]);

  const handleReset = async () => {
    if (!selectedCycleId) return;
    const updated = await resetRoute(selectedCycleId);
    setPlan(updated);
  };

  const handleLock = async () => {
    if (!selectedCycleId) return;
    const updated = await lockRoute(selectedCycleId);
    setPlan(updated);
  };

  const handleUnlock = async () => {
    if (!selectedCycleId) return;
    const updated = await unlockRoute(selectedCycleId);
    setPlan(updated);
  };

  const selectedBatch = batches.find((b) => b.cycleId === selectedCycleId);

  if (loading && !plan && batches.length === 0) {
    return <div className="app app--loading">Loading…</div>;
  }

  if (error) {
    return <div className="app app--error">{error}</div>;
  }

  return (
    <>
    <div className="app">
      <header className="header">
        <div>
          <h1>PA Wine Routing</h1>
          <p className="header__sub">
            Scranton warehouse (310 Genet Street) · Territory cutoffs · 10 AM – 4 PM delivery windows
          </p>
        </div>
        <div className="header__actions">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={handleReset}
            disabled={!plan || plan.status === "locked"}
          >
            Reset to suggested
          </button>
          {plan?.status === "locked" && selectedBatch && (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => printRoutePdf()}
            >
              Print PDF
            </button>
          )}
          {plan?.status === "locked" ? (
            <button type="button" className="btn btn--primary" onClick={() => void handleUnlock()}>
              Unlock route
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void handleLock()}
              disabled={!plan}
            >
              Lock route
            </button>
          )}
        </div>
      </header>

      <aside className="sidebar">
        <CustomerUpload
          onUploaded={() => void handleOrdersApplied()}
          onCustomersLoaded={handleCustomersLoaded}
        />
        <OrderSelector
          refreshKey={orderListKey}
          onApplied={() => void handleOrdersApplied()}
        />
        <h2>Territories</h2>
        {batches.length === 0 ? (
          <p className="sidebar__empty">No routes yet — upload a CSV and apply orders.</p>
        ) : (
          <ul className="batch-list">
            {batches.map((b) => (
              <li key={b.cycleId}>
                <button
                  type="button"
                  className={`batch-item ${selectedCycleId === b.cycleId ? "batch-item--active" : ""}`}
                  onClick={() => setSelectedCycleId(b.cycleId)}
                >
                  <strong>{b.territoryName}</strong>
                  {b.multiDay && <span className="badge">Multi-day</span>}
                  <span className="batch-item__meta">
                    {b.stopCount} stops · {b.totalCases} cases
                  </span>
                  <span className="batch-item__date">Delivers {b.deliveryDate}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <main className="main">
        {plan && selectedBatch ? (
          <>
            <div className="main__header">
              <h2>{plan.territoryName}</h2>
              <p>
                Delivery {plan.deliveryDate} · Batch {plan.batchId} ·{" "}
                {plan.allStops.length} stops ·{" "}
                {plan.allStops.reduce((s, st) => s + st.cases, 0)} cases · Depot:{" "}
                {plan.depot.address}, {plan.depot.city}
              </p>
              <p className="main__cutoff">
                Cutoff {formatDateTime(selectedBatch.cutoffAt)} ·
                {selectedBatch.multiDay
                  ? " Multi-day route (truck stays out overnight)"
                  : " Same-day return to Scranton"}
                {plan.travelTimeSource && (
                  <>
                    {" "}
                    · Drive times:{" "}
                    {plan.travelTimeSource === "google" ? "Google Maps" : "estimated"}
                  </>
                )}
              </p>
            </div>
            <RouteView
              cycleId={selectedCycleId!}
              plan={plan}
              previewSegments={previewSegments}
              activeStopId={activeStopId}
              onUpdate={handleUpdate}
              onPreviewSegments={setPreviewSegments}
              onActiveStopChange={setActiveStopId}
              onWedThresholdChange={
                plan.segments.some((s) => s.segmentType === "day")
                  ? handleWedThreshold
                  : undefined
              }
              onAddTruck={
                !plan.segments.some((s) => s.segmentType === "day") ? handleAddTruck : undefined
              }
            />
          </>
        ) : (
          <div className="main__empty">
            <h2>Route board</h2>
            <p>Upload your weekly customer CSV, select accounts with orders, then apply to build routes.</p>
          </div>
        )}
      </main>
    </div>
    {plan?.status === "locked" && selectedBatch && (
      <RoutePrintSheet plan={plan} batch={selectedBatch} />
    )}
    </>
  );
}
