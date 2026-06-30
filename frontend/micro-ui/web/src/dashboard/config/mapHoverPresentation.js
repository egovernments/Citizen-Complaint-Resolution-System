import { formatDimensionLabel } from "./labelFormat";
import { formatWorkflowStatusLabel } from "./complaintsAtRiskPresentation";

const PIN_SLA_LABELS = {
  within: "Within SLA",
  approaching: "Nearing breach",
  breached: "Breached",
};
const PIN_CHANNEL_LABELS = {
  web: "Web",
  mobile: "Mobile app",
  csc: "Counter (CSC)",
  ivr: "IVR",
  whatsapp: "WhatsApp",
  sms: "SMS",
  email: "Email",
};
const titleCaseWord = (v) =>
  String(v ?? "").replace(/\b\w/g, (c) => c.toUpperCase());

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
function formatPinDate(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  try {
    return new Date(n).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return null;
  }
}

export function buildComplaintPinTooltipHtml(pin = {}) {
  const title = pin.serviceCode ? formatDimensionLabel(pin.serviceCode) : "Complaint";
  const status = pin.status ? formatWorkflowStatusLabel(pin.status) : "—";
  const ward = pin.wardCode ? formatDimensionLabel(pin.wardCode) : null;
  const filed = formatPinDate(pin.createdDate);
  const channel = pin.source
    ? PIN_CHANNEL_LABELS[String(pin.source).toLowerCase()] || titleCaseWord(pin.source)
    : null;
  const sla = pin.slaStatus
    ? PIN_SLA_LABELS[String(pin.slaStatus).toLowerCase()] || titleCaseWord(pin.slaStatus)
    : null;

  return `
    <div class="dashboard-map-hover-card dashboard-map-hover-card--pin">
      <div class="dashboard-map-hover-title">${escapeHtml(title)}</div>
      ${metricRow("Status", status)}
      ${ward ? metricRow("Ward", ward) : ""}
      ${filed ? metricRow("Filed", filed) : ""}
      ${channel ? metricRow("Channel", channel) : ""}
      ${sla ? metricRow("SLA", sla) : ""}
      ${pin.serviceRequestId ? metricRow("ID", pin.serviceRequestId) : ""}
      ${
        pin.approximate
          ? '<div class="dashboard-map-hover-note">Approximate location (ward centroid)</div>'
          : ""
      }
    </div>
  `;
}
