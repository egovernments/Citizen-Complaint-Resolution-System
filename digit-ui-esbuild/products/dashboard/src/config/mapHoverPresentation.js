// Not a component — translate lazily inside render-time functions only (never
// at module level), so language switches pick up fresh strings. Pin field
// values (channel / SLA / status) resolve through dimensionLabel against
// DASHBOARD_CHANNEL_* / DASHBOARD_SLA_* / DASHBOARD_WF_STAGE_* messages; no
// code-owned fallbacks — unseeded values surface their raw code.
import { translate as t, getLanguage } from "../i18n/localeRuntime";
import { dimensionLabel } from "../i18n/dimensionLabel";

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
export function buildMapHoverTooltipHtml(ward = {}, { layerMode = "created", geoLevel } = {}) {
  const label = ward.label || ward.wardCode || t("DASHBOARD_MAP_AREA", "Area");
  const level = geoLevel ?? t("DASHBOARD_GEO_LEVEL_0", "District");
  const created = ward.created ?? ward.count ?? 0;
  const open = ward.open ?? 0;
  const resolved = ward.resolved ?? 0;
  const openPct = ward.openPct ?? (created > 0 ? (open / created) * 100 : 0);
  const resolvedPct = ward.resolvedPct ?? (created > 0 ? (resolved / created) * 100 : 0);

  const rows = [];
  if (layerMode === "open") {
    rows.push(metricRow(t("DASHBOARD_MAP_HOVER_PCT_OPEN", "% Open"), formatPct(openPct)));
  } else if (layerMode === "resolved") {
    rows.push(metricRow(t("DASHBOARD_MAP_HOVER_PCT_RESOLVED", "% Resolved"), formatPct(resolvedPct)));
  } else {
    rows.push(metricRow(t("DASHBOARD_MAP_HOVER_CREATED", "Created"), created));
  }

  if (layerMode !== "created") {
    rows.push(metricRow(t("DASHBOARD_MAP_HOVER_TOTAL_CREATED", "Total created"), created));
    rows.push(metricRow(t("DASHBOARD_MAP_HOVER_OPEN", "Open"), open));
    rows.push(metricRow(t("DASHBOARD_MAP_HOVER_RESOLVED", "Resolved"), resolved));
  }

  return `
    <div class="dashboard-map-hover-card">
      <div class="dashboard-map-hover-title">${escapeHtml(label)} · ${escapeHtml(level)}</div>
      ${rows.join("")}
    </div>
  `;
}

/** Hover card for an individual complaint pin. */
function formatPinDate(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  try {
    return new Date(n).toLocaleDateString(getLanguage()?.replace("_", "-"), {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return null;
  }
}

export function buildComplaintPinTooltipHtml(pin = {}) {
  const title = pin.serviceCode
    ? dimensionLabel(pin.serviceCode, "complaintType")
    : t("DASHBOARD_MAP_PIN_COMPLAINT", "Complaint");
  const status = pin.status ? dimensionLabel(pin.status, "workflowStatus") : "—";
  const ward = pin.wardCode ? dimensionLabel(pin.wardCode, "boundary") : null;
  const filed = formatPinDate(pin.createdDate);
  const channel = pin.source ? dimensionLabel(pin.source, "channel") : null;
  const sla = pin.slaStatus ? dimensionLabel(pin.slaStatus, "slaState") : null;

  return `
    <div class="dashboard-map-hover-card dashboard-map-hover-card--pin">
      <div class="dashboard-map-hover-title">${escapeHtml(title)}</div>
      ${metricRow(t("DASHBOARD_MAP_PIN_STATUS", "Status"), status)}
      ${ward ? metricRow(t("DASHBOARD_MAP_PIN_WARD", "Ward"), ward) : ""}
      ${filed ? metricRow(t("DASHBOARD_MAP_PIN_FILED", "Filed"), filed) : ""}
      ${channel ? metricRow(t("DASHBOARD_MAP_PIN_CHANNEL", "Channel"), channel) : ""}
      ${sla ? metricRow(t("DASHBOARD_MAP_PIN_SLA", "SLA"), sla) : ""}
      ${pin.serviceRequestId ? metricRow(t("DASHBOARD_MAP_PIN_ID", "ID"), pin.serviceRequestId) : ""}
      ${
        pin.approximate
          ? `<div class="dashboard-map-hover-note">${escapeHtml(
              t("DASHBOARD_MAP_PIN_APPROXIMATE", "Approximate location (ward centroid)")
            )}</div>`
          : ""
      }
    </div>
  `;
}
