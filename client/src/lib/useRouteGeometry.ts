import { useEffect, useMemo, useRef, useState } from "react";
import type { RoutePlan } from "@shared/types";
import { fetchRouteGeometry, type RouteGeometryResponse } from "./api";
import type { SegmentUpdate } from "./segmentDrag";
import { segmentRoutesCacheKey, type LatLng } from "./routeMapUtils";

export function useRouteGeometry(
  cycleId: string | null,
  plan: RoutePlan,
  previewSegments: SegmentUpdate[] | null
) {
  const [geometry, setGeometry] = useState<{
    routeKey: string;
    data: RouteGeometryResponse;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);
  const routeKey = useMemo(
    () => segmentRoutesCacheKey(plan, previewSegments),
    [plan, previewSegments]
  );

  useEffect(() => {
    if (!cycleId) {
      setGeometry(null);
      return;
    }

    const debounceMs = previewSegments ? 250 : 0;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = () => {
      const id = ++requestId.current;
      setLoading(true);
      void fetchRouteGeometry(
        cycleId,
        previewSegments ? { segments: previewSegments } : undefined,
        controller.signal
      )
        .then((result) => {
          if (id !== requestId.current) return;
          setGeometry({ routeKey, data: result });
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          if (id !== requestId.current) return;
          console.warn("Route geometry fetch failed:", err);
        })
        .finally(() => {
          if (id === requestId.current) setLoading(false);
        });
    };

    if (debounceMs > 0) {
      timer = setTimeout(run, debounceMs);
    } else {
      run();
    }

    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [cycleId, previewSegments, routeKey]);

  const geometryPaths = useMemo(() => {
    if (!geometry || geometry.routeKey !== routeKey) return null;
    return new Map<string, LatLng[]>(
      geometry.data.segments.map((seg) => [
        seg.segmentId,
        seg.path.map((p) => [p.lat, p.lng] as LatLng),
      ])
    );
  }, [geometry, routeKey]);

  return {
    geometryPaths,
    geometrySource: geometry?.routeKey === routeKey ? geometry.data.source : null,
    loading,
  };
}
