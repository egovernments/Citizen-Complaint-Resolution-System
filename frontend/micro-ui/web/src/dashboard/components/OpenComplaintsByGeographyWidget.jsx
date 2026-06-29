import React, { useMemo, useState } from "react";
import {
  buildWidgetHeaderClassName,
  SHARED_CHROME,
  VIZ_TYPE,
} from "../config/visualizationStyles";
import {
  GEOGRAPHY_MAP_LAYERS,
  isGeographyMapLayerId,
} from "../config/geographyMapPresentation";
import { getMapCityLabel } from "../utils/mapGeoUtils";
import GeographyChoroplethMap from "./GeographyChoroplethMap";

const OpenComplaintsByGeographyWidget = ({ layers, loading = false }) => {
  const [activeLayer, setActiveLayer] = useState("created");
  const cityLabel = getMapCityLabel();

  const resolvedLayer = isGeographyMapLayerId(activeLayer) ? activeLayer : "created";
  const wardCounts = useMemo(
    () => layers?.[resolvedLayer] ?? [],
    [layers, resolvedLayer]
  );

  if (loading && !wardCounts.length) {
    return (
      <div className="tw-flex tw-h-full tw-min-h-[220px] tw-items-center tw-justify-center tw-p-4 tw-text-[12px] tw-text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <div className="tw-flex tw-h-full tw-min-h-0 tw-flex-col">
      <header
        className={`${buildWidgetHeaderClassName(VIZ_TYPE.MAP)} dashboard-map-header-bar ${SHARED_CHROME.dragHandle} tw-flex tw-shrink-0 tw-items-center tw-px-3 tw-pb-2 tw-pt-2 tw-pr-8`}
      >
        <h2 className={SHARED_CHROME.dragHandleTitle}>Complaint map · {cityLabel}</h2>
      </header>
      <GeographyChoroplethMap
        wardCounts={wardCounts}
        complaintPins={layers?.complaintPins ?? []}
        complaintPinsError={layers?.complaintPinsError ?? null}
        layerMode={resolvedLayer}
        onLayerModeChange={setActiveLayer}
        layerOptions={GEOGRAPHY_MAP_LAYERS}
        cityLabel={cityLabel}
      />
    </div>
  );
};

export default OpenComplaintsByGeographyWidget;
