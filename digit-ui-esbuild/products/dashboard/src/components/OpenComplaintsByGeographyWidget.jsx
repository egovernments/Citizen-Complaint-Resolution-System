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
import useDashboardT from "../i18n/useDashboardT";
import GeographyChoroplethMap from "./GeographyChoroplethMap";

const OpenComplaintsByGeographyWidget = ({ layers, loading = false }) => {
  const { t, language } = useDashboardT();
  const [activeLayer, setActiveLayer] = useState("created");
  const cityLabel = getMapCityLabel();

  const resolvedLayer = isGeographyMapLayerId(activeLayer) ? activeLayer : "created";

  // Localized layer-toggle labels; re-keyed on `language` so a host language
  // switch rebuilds the option objects (they feed imperative Leaflet chrome too).
  const layerOptions = useMemo(
    () =>
      GEOGRAPHY_MAP_LAYERS.map((layer) => ({
        ...layer,
        label:
          layer.id === "open"
            ? t("DASHBOARD_MAP_LAYER_OPEN", "Open")
            : layer.id === "resolved"
              ? t("DASHBOARD_MAP_LAYER_RESOLVED", "Resolved")
              : t("DASHBOARD_MAP_LAYER_CREATED", "Created"),
      })),
    [language] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const wardCounts = useMemo(() => {
    const series = layers?.[resolvedLayer] ?? [];
    const details = layers?.wardDetails ?? {};
    return series.map((row) => ({
      ...details[row.wardCode],
      ...row,
    }));
  }, [layers, resolvedLayer]);

  if (loading && !wardCounts.length) {
    return (
      <div className="tw-flex tw-h-full tw-min-h-[220px] tw-items-center tw-justify-center tw-p-4 tw-text-[12px] tw-text-muted-foreground">
        {t("DASHBOARD_MAP_LOADING", "Loading…")}
      </div>
    );
  }

  return (
    <div className="tw-flex tw-h-full tw-min-h-0 tw-flex-col">
      <header
        className={`${buildWidgetHeaderClassName(VIZ_TYPE.MAP)} dashboard-map-header-bar ${SHARED_CHROME.dragHandle} tw-flex tw-shrink-0 tw-items-center tw-px-3 tw-pb-2 tw-pt-4 tw-pr-8`}
      >
        <h2 className={SHARED_CHROME.dragHandleTitle}>
          {t("DASHBOARD_MAP_TITLE", "Complaint map")} · {cityLabel}
        </h2>
      </header>
      <GeographyChoroplethMap
        wardCounts={wardCounts}
        complaintPins={layers?.complaintPinsByLayer?.[resolvedLayer] ?? []}
        complaintPinsError={layers?.complaintPinsError ?? null}
        layerMode={resolvedLayer}
        onLayerModeChange={setActiveLayer}
        layerOptions={layerOptions}
        cityLabel={cityLabel}
      />
    </div>
  );
};

export default OpenComplaintsByGeographyWidget;
