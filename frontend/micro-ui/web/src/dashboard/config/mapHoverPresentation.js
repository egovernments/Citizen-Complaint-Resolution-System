import { formatDimensionLabel } from "./kpiQueries";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function metricRow(label, value) {
  return `<div class="dashboard-map-hover-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function formatPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n)}%`;
}

/**
 * Hover card for ward polygons — matches reference layout with layer highlight + totals.
 */
export function buildMapHoverTooltipHtml(ward = {}, { layerMode = "created", geoLevel = "District" } = {}) {
  const label = ward.label || ward.wardCode || "Area";
  const created = ward.created ?? ward.count ?? 0;
  const open = ward.open ?? 0;
  const resolved = ward.resolved ?? 0;
  const openPct = ward.openPct ?? (created > 0 ? (open / created) * 100 : 0);
  const resolvedPct = ward.resolvedPct ?? (created > 0 ? (resolved / created) * 100 : 0);

  const rows = [];
  if (layerMode === "open") {
    rows.push(metricRow("% Open", formatPct(openPct)));
  } else if (layerMode === "resolved") {
    rows.push(metricRow("% Resolved", formatPct(resolvedPct)));
  } else {
    rows.push(metricRow("Created", created));
  }

  if (layerMode !== "created") {
    rows.push(metricRow("Total created", created));
    rows.push(metricRow("Open", open));
    rows.push(metricRow("Resolved", resolved));
  }

  return `
    <div class="dashboard-map-hover-card">
      <div class="dashboard-map-hover-title">${escapeHtml(label)} · ${escapeHtml(geoLevel)}</div>
      ${rows.join("")}
    </div>
  `;
}

/** Hover card for an individual complaint pin. */
export function buildComplaintPinTooltipHtml(pin = {}) {
  const title = pin.serviceCode || "Complaint";
  const status = pin.status || "—";
  const ward = pin.wardCode ? formatDimensionLabel(pin.wardCode) : null;

  return `
    <div class="dashboard-map-hover-card dashboard-map-hover-card--pin">
      <div class="dashboard-map-hover-title">${escapeHtml(title)}</div>
      ${metricRow("Status", status)}
      ${ward ? metricRow("Ward", ward) : ""}
      ${pin.serviceRequestId ? metricRow("ID", pin.serviceRequestId) : ""}
      ${
        pin.approximate
          ? '<div class="dashboard-map-hover-note">Approximate location (ward centroid)</div>'
          : ""
      }
    </div>
  `;
}
