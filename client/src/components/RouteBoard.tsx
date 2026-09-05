import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMemo, useState } from "react";
import type { RoutePlan, Segment, SegmentValidation, Stop } from "@shared/types";
import { SERVICE_MINUTES_PER_STOP } from "@shared/constants";
import { formatDurationMinutes } from "@shared/timeFormat";
import { computeSegmentUpdate, type SegmentUpdate } from "../lib/segmentDrag";
import ContactDisplay from "./ContactDisplay";
import AddStopPanel from "./AddStopPanel";

interface RouteBoardProps {
  plan: RoutePlan;
  onUpdate: (segments: SegmentUpdate[]) => void;
  onPreviewSegments?: (segments: SegmentUpdate[] | null) => void;
  onActiveStopChange?: (stopId: string | null) => void;
  onRemoveStop?: (customerId: string) => void;
  onClearRoute?: () => void;
  onStopAdded?: (plan: RoutePlan) => void;
  onWedThresholdChange?: (n: number) => void;
  onAddTruck?: () => void;
}

function StopCard({
  stop,
  eta,
  driveMinutes,
  hasError,
  onRemove,
  removeDisabled,
}: {
  stop: Stop;
  eta?: string;
  driveMinutes?: number;
  hasError?: boolean;
  onRemove?: () => void;
  removeDisabled?: boolean;
}) {
  return (
    <div className={`stop-card ${hasError ? "stop-card--error" : ""}`}>
      <span className="stop-card__grip">⋮⋮</span>
      <div className="stop-card__body">
        <strong>{stop.customerName}</strong>
        <span className="stop-card__meta">{stop.city}</span>
        {(stop.contactName || stop.contactPhone) && (
          <span className="stop-card__contact">
            Contact: <ContactDisplay contactName={stop.contactName} contactPhone={stop.contactPhone} />
          </span>
        )}
        {stop.deliveryInstructions && (
          <span className="stop-card__instructions">{stop.deliveryInstructions}</span>
        )}
        {typeof driveMinutes === "number" && driveMinutes > 0 && (
          <span className="stop-card__drive">{driveMinutes} min drive from previous</span>
        )}
        {eta && <span className="stop-card__eta">ETA {eta}</span>}
      </div>
      {onRemove && (
        <button
          type="button"
          className="stop-card__remove"
          disabled={removeDisabled}
          title="Remove from route"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

function SortableStop({
  stop,
  eta,
  driveMinutes,
  hasError,
  disabled,
  onRemove,
}: {
  stop: Stop;
  eta?: string;
  driveMinutes?: number;
  hasError?: boolean;
  disabled?: boolean;
  onRemove?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: stop.id,
    disabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <StopCard
        stop={stop}
        eta={eta}
        driveMinutes={driveMinutes}
        hasError={hasError}
        onRemove={onRemove}
        removeDisabled={disabled}
      />
    </div>
  );
}

function segmentTotalMinutes(v: SegmentValidation): number {
  if (v.totalRouteMinutes != null && v.totalRouteMinutes > 0) {
    return v.totalRouteMinutes;
  }
  const drive =
    v.totalDriveMinutes ??
    Object.values(v.stopDriveMinutes ?? {}).reduce((sum, n) => sum + n, 0);
  return drive + v.stopCount * SERVICE_MINUTES_PER_STOP;
}

function SegmentColumn({
  segment,
  stops,
  disabled,
  onRemoveStop,
}: {
  segment: Segment;
  stops: Stop[];
  disabled?: boolean;
  onRemoveStop?: (customerId: string) => void;
}) {
  const stopIds = stops.map((s) => s.id);
  const v = segment.validation;
  const { setNodeRef, isOver } = useDroppable({ id: `segment-${segment.id}` });

  return (
    <div className="segment-column" ref={setNodeRef} data-over={isOver}>
      <div className="segment-column__header">
        <h3>{segment.label}</h3>
        <p className="segment-column__date">{segment.deliveryDate}</p>
        <div className="segment-column__stats">
          <span>{v.stopCount} stops</span>
          <span>{v.totalCases} cases</span>
          <span>{v.totalMiles} mi</span>
        </div>
        {v.stopCount > 0 && (
          <p className="segment-column__total-time">
            Total time: {formatDurationMinutes(segmentTotalMinutes(v))}
            <span className="segment-column__total-time-detail"> (drive + {SERVICE_MINUTES_PER_STOP} min/stop service)</span>
          </p>
        )}
        {v.stopCount > 0 && (
          <p className="segment-column__first-stop">First stop: 10:00 AM</p>
        )}
        {v.departureTime && (
          <p className="segment-column__depart">Depart: {v.departureTime}</p>
        )}
        {v.completionTime && v.stopCount > 0 && (
          <p className="segment-column__complete">Done by: {v.completionTime}</p>
        )}
        {segment.startLocation === "overnight" && (
          <p className="segment-column__note">Start: overnight (no warehouse return)</p>
        )}
        {segment.endLocation === "overnight" && (
          <p className="segment-column__note">End: overnight near territory</p>
        )}
      </div>

      <SortableContext items={stopIds} strategy={verticalListSortingStrategy}>
        <div className="segment-column__stops">
          {stops.length === 0 && <p className="segment-column__empty">Drop stops here</p>}
          {stops.map((stop) => {
            const eta = v.stopEtas[stop.id];
            const driveMinutes = v.stopDriveMinutes?.[stop.id];
            const hasError = v.errors.some((e) => e.includes(stop.customerName));
            return (
              <SortableStop
                key={stop.id}
                stop={stop}
                eta={eta}
                driveMinutes={driveMinutes}
                hasError={hasError}
                disabled={disabled}
                onRemove={onRemoveStop ? () => onRemoveStop(stop.customerId) : undefined}
              />
            );
          })}
        </div>
      </SortableContext>

      {(v.warnings.length > 0 || v.errors.length > 0) && (
        <div className="segment-column__alerts">
          {v.errors.map((e) => (
            <p key={e} className="alert alert--error">
              {e}
            </p>
          ))}
          {v.warnings.map((w) => (
            <p key={w} className="alert alert--warn">
              {w}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export default function RouteBoard({
  plan,
  onUpdate,
  onPreviewSegments,
  onActiveStopChange,
  onRemoveStop,
  onClearRoute,
  onStopAdded,
  onWedThresholdChange,
  onAddTruck,
}: RouteBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const stopMap = useMemo(() => new Map(plan.allStops.map((s) => [s.id, s])), [plan.allStops]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const segmentStops = useMemo(
    () =>
      plan.segments.map((seg) => ({
        segment: seg,
        stops: seg.stops
          .map((a) => stopMap.get(a.stopId))
          .filter((s): s is Stop => !!s),
      })),
    [plan.segments, stopMap]
  );

  const wedCount = plan.segments[0]?.stops.length ?? 0;
  const isMultiDay = plan.segments.some((s) => s.segmentType === "day");

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    setActiveId(id);
    onActiveStopChange?.(id);
  }

  function handleDragOver(event: DragOverEvent) {
    if (plan.status === "locked" || !onPreviewSegments) return;
    const { active, over } = event;
    if (!over) {
      onPreviewSegments(null);
      return;
    }
    const preview = computeSegmentUpdate(plan, String(active.id), String(over.id));
    onPreviewSegments(preview);
  }

  function handleDragEnd(event: DragEndEvent) {
    onPreviewSegments?.(null);
    onActiveStopChange?.(null);
    setActiveId(null);
    const { active, over } = event;
    if (!over || plan.status === "locked") return;

    const newSegments = computeSegmentUpdate(plan, String(active.id), String(over.id));
    if (newSegments) onUpdate(newSegments);
  }

  function handleDragCancel() {
    onPreviewSegments?.(null);
    onActiveStopChange?.(null);
    setActiveId(null);
  }

  const activeStop = activeId ? stopMap.get(activeId) : null;
  const allErrors = plan.segments.flatMap((s) => s.validation.errors);
  const assignedCount = plan.segments.reduce((n, s) => n + s.stops.length, 0);

  const isLocked = plan.status === "locked";

  return (
    <div className="route-board">
      <div className="route-board__toolbar">
        {isMultiDay && onWedThresholdChange && !isLocked && (
          <label className="wed-slider">
            Wed stop threshold:{" "}
            <input
              type="range"
              min={0}
              max={plan.allStops.length}
              value={wedCount}
              onChange={(e) => onWedThresholdChange(Number(e.target.value))}
            />
            <strong>{wedCount}</strong>
            <span className="wed-slider__hint">
              (suggested: {plan.suggestedWedThreshold ?? "—"})
            </span>
          </label>
        )}
        {!isMultiDay && onAddTruck && !isLocked && (
          <button type="button" className="btn btn--secondary" onClick={onAddTruck}>
            + Add truck
          </button>
        )}
        {onClearRoute && !isLocked && plan.allStops.length > 0 && (
          <button type="button" className="btn btn--secondary" onClick={onClearRoute}>
            Clear route
          </button>
        )}
        {onStopAdded && (
          <AddStopPanel
            cycleId={plan.cycleId}
            territoryId={plan.territoryId}
            territoryName={plan.territoryName}
            disabled={isLocked}
            onAdded={onStopAdded}
          />
        )}
        {isLocked && (
          <span className="route-board__locked-badge">Route locked — unlock to edit</span>
        )}
        <span className="route-board__assign">
          {assignedCount}/{plan.allStops.length} stops assigned
        </span>
      </div>

      {allErrors.length > 0 && (
        <div className="route-board__banner route-board__banner--error">
          {allErrors.length} validation issue(s) — adjust stop order or split across segments
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div
          className="route-board__columns"
          style={{ gridTemplateColumns: `repeat(${plan.segments.length}, 1fr)` }}
        >
          {segmentStops.map(({ segment, stops }) => (
            <SegmentColumn
              key={segment.id}
              segment={segment}
              stops={stops}
              disabled={plan.status === "locked"}
              onRemoveStop={!isLocked ? onRemoveStop : undefined}
            />
          ))}
        </div>

        <DragOverlay>
          {activeStop ? <StopCard stop={activeStop} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
