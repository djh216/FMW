import RouteBoard from "./RouteBoard";
import RouteMap from "./RouteMap";
import { useRouteGeometry } from "../lib/useRouteGeometry";
import type { SegmentUpdate } from "../lib/segmentDrag";
import type { RoutePlan } from "@shared/types";

interface RouteViewProps {
  cycleId: string;
  plan: RoutePlan;
  previewSegments: SegmentUpdate[] | null;
  activeStopId: string | null;
  onUpdate: (segments: SegmentUpdate[]) => void;
  onPreviewSegments: (segments: SegmentUpdate[] | null) => void;
  onActiveStopChange: (stopId: string | null) => void;
  onRemoveStop?: (customerId: string) => void;
  onClearRoute?: () => void;
  onStopAdded?: (plan: RoutePlan) => void;
  onWedThresholdChange?: (n: number) => void;
  onAddTruck?: () => void;
}

export default function RouteView({
  cycleId,
  plan,
  previewSegments,
  activeStopId,
  onUpdate,
  onPreviewSegments,
  onActiveStopChange,
  onRemoveStop,
  onClearRoute,
  onStopAdded,
  onWedThresholdChange,
  onAddTruck,
}: RouteViewProps) {
  const { geometryPaths, geometrySource, loading: geometryLoading } = useRouteGeometry(
    cycleId,
    plan,
    previewSegments
  );

  return (
    <div className="main__route-view">
      <RouteMap
        plan={plan}
        previewSegments={previewSegments}
        activeStopId={activeStopId}
        geometryPaths={geometryPaths}
        geometrySource={geometrySource}
        geometryLoading={geometryLoading}
      />
      <RouteBoard
        plan={plan}
        onUpdate={onUpdate}
        onPreviewSegments={onPreviewSegments}
        onActiveStopChange={onActiveStopChange}
        onRemoveStop={onRemoveStop}
        onClearRoute={onClearRoute}
        onStopAdded={onStopAdded}
        onWedThresholdChange={onWedThresholdChange}
        onAddTruck={onAddTruck}
      />
    </div>
  );
}
