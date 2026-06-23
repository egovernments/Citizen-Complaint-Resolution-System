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
import ViewToggle from "./demo/ViewToggle";
import GeographyChoroplethMap from "./GeographyChoroplethMap";

const OpenComplaintsByGeographyWidget = ({ layers, loading = false }) => {
  const [activeLayer, setActiveLayer] = useState("open");

  const resolvedLayer = isGeographyMapLayerId(activeLayer) ? activeLayer : "open";
  const layerMeta = GEOGRAPHY_MAP_LAYERS.find((layer) => layer.id === resolvedLayer);
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
        className={`${buildWidgetHeaderClassName(VIZ_TYPE.MAP)} tw-flex tw-shrink-0 tw-items-center tw-justify-between tw-gap-3 tw-pr-8`}
      >
        <div className="tw-min-w-0 tw-flex-1">
          <h2 className={SHARED_CHROME.dragHandleTitle}>Open complaints by geography</h2>
          <p className={SHARED_CHROME.dragHandleSubtitle}>
            Choropleth by ward — {layerMeta?.description ?? "toggle layer"}
          </p>
        </div>
        <ViewToggle
          value={resolvedLayer}
          onChange={setActiveLayer}
          options={GEOGRAPHY_MAP_LAYERS.map((layer) => ({
            id: layer.id,
            label: layer.label,
          }))}
        />
      </header>
      <GeographyChoroplethMap wardCounts={wardCounts} layerLabel={layerMeta?.label ?? "Open"} />
    </div>
  );
};

export default OpenComplaintsByGeographyWidget;
