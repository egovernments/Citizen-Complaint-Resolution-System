import { formatDimensionLabel } from "./labelFormat";

function formatWowPct(wowPct) {
  if (!Number.isFinite(wowPct)) return "new spike";
  const rounded = Math.round(wowPct);
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

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

function slaPill(dotClass, count, label) {
  return `<span class="dashboard-map-hover-pill"><span class="dashboard-map-hover-dot ${dotClass}"></span>${escapeHtml(count)} ${escapeHtml(label)}</span>`;
}

/**
 * Rich hover card — WoW stats + SLA bucket counts (matches reference).
 */
export function buildMapHoverTooltipHtml(ward = {}, { geoLevel = "Locality" } = {}) {
  const label = ward.label || ward.wardCode || "Area";
  const current = ward.current ?? ward.count ?? 0;
  const prior = ward.prior ?? 0;
  const total = ward.total ?? current;
  const breachSharePct = Math.round(ward.breachSharePct ?? 0);
  const within = ward.slaWithin ?? 0;
  const breaching = ward.slaApproaching ?? 0;
  const breached = ward.slaBreached ?? ward.breached ?? 0;

  return `
    <div class="dashboard-map-hover-card">
      <div class="dashboard-map-hover-title">${escapeHtml(label)} · ${escapeHtml(geoLevel)}</div>
      ${metricRow("This week", current)}
      ${metricRow("Last week", prior)}
      ${metricRow("WoW", formatWowPct(ward.wowPct))}
      ${metricRow("Total", total)}
      <div class="dashboard-map-hover-row"><span>SLA breach share</span><strong>${breachSharePct}%</strong></div>
      <div class="dashboard-map-hover-sla">
        ${slaPill("dashboard-map-hover-dot--within", within, "within")}
        ${slaPill("dashboard-map-hover-dot--breaching", breaching, "breaching")}
        ${slaPill("dashboard-map-hover-dot--breached", breached, "breached")}
      </div>
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
