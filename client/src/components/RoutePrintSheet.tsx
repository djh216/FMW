import type { BatchSummary, RoutePlan, Stop } from "@shared/types";
import { formatDateTime } from "@shared/timeFormat";
import ContactDisplay from "./ContactDisplay";

interface RoutePrintSheetProps {
  plan: RoutePlan;
  batch: BatchSummary;
}

export default function RoutePrintSheet({ plan, batch }: RoutePrintSheetProps) {
  const stopMap = new Map(plan.allStops.map((s) => [s.id, s]));
  const printedAt = formatDateTime(new Date());

  return (
    <div className="route-print-sheet" aria-hidden="true">
      <header className="route-print-sheet__header">
        <h1>{plan.territoryName}</h1>
        <p className="route-print-sheet__meta">
          Delivery {plan.deliveryDate} · Batch {plan.batchId} · {plan.allStops.length} stops
        </p>
        <p className="route-print-sheet__meta">
          Depot: {plan.depot.address}, {plan.depot.city} · Cutoff{" "}
          {formatDateTime(batch.cutoffAt)}
          {batch.multiDay ? " · Multi-day route" : " · Same-day return to Scranton"}
        </p>
        <p className="route-print-sheet__meta route-print-sheet__locked">
          LOCKED ROUTE · Printed {printedAt}
        </p>
      </header>

      {plan.segments.map((segment) => {
        const stops = segment.stops
          .map((a) => stopMap.get(a.stopId))
          .filter((s): s is Stop => !!s);
        const v = segment.validation;

        return (
          <section key={segment.id} className="route-print-segment">
            <div className="route-print-segment__head">
              <h2>{segment.label}</h2>
              <p>
                {segment.deliveryDate}
                {v.departureTime ? ` · Depart ${v.departureTime}` : ""}
                {v.completionTime && v.stopCount > 0 ? ` · Done by ${v.completionTime}` : ""}
                {" · "}
                {v.stopCount} stops · {v.totalMiles} mi
              </p>
              {segment.startLocation === "overnight" && (
                <p className="route-print-segment__note">Starts overnight (no warehouse return)</p>
              )}
              {segment.endLocation === "overnight" && (
                <p className="route-print-segment__note">Ends overnight near territory</p>
              )}
            </div>

            {stops.length === 0 ? (
              <p className="route-print-segment__empty">No stops</p>
            ) : (
              <table className="route-print-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Restaurant</th>
                    <th>Contact</th>
                    <th>ETA</th>
                    <th>Delivery instructions</th>
                  </tr>
                </thead>
                <tbody>
                  {stops.map((stop, idx) => (
                    <tr key={stop.id} className="route-print-stop">
                      <td>{idx + 1}</td>
                      <td>{stop.customerName}</td>
                      <td>
                        <ContactDisplay
                          contactName={stop.contactName}
                          contactPhone={stop.contactPhone}
                        />
                      </td>
                      <td>{v.stopEtas[stop.id] ?? "—"}</td>
                      <td>{stop.deliveryInstructions || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
    </div>
  );
}
