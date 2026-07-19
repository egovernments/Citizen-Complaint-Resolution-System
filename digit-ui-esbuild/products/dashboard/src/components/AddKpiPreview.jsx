import React from "react";
import { createPortal } from "react-dom";
import {
  ADD_KPI_PREVIEW_GAP_PX,
  ADD_KPI_PREVIEW_WIDTH_PX,
  buildAddKpiPreviewContent,
} from "../config/addKpiPreviewPresentation";

const AddKpiPreview = ({ item, anchorRect, panelLeft, kpiCardData }) => {
  const content = buildAddKpiPreviewContent(item, { kpiCardData });
  if (!content || !anchorRect || panelLeft == null) return null;

  const left = Math.max(8, panelLeft - ADD_KPI_PREVIEW_WIDTH_PX - ADD_KPI_PREVIEW_GAP_PX);
  const top = Math.max(8, anchorRect.top - 4);

  return createPortal(
    <div
      className="dashboard-add-kpi-preview dashboard-root"
      style={{
        position: "fixed",
        top,
        left,
        width: ADD_KPI_PREVIEW_WIDTH_PX,
        zIndex: 10000,
      }}
      aria-live="polite"
      role="status"
    >
      <div className="dashboard-add-kpi-preview-card">
        <div className="dashboard-add-kpi-preview-title">{content.title}</div>
        {content.value ? (
          <div className="dashboard-add-kpi-preview-value">{content.value}</div>
        ) : null}
        {content.target ? (
          <div className="dashboard-add-kpi-preview-target">{content.target}</div>
        ) : null}
        {content.description ? (
          <p className="dashboard-add-kpi-preview-desc">{content.description}</p>
        ) : null}
      </div>
    </div>,
    document.body
  );
};

export default AddKpiPreview;
